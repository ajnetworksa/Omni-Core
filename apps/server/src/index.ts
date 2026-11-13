import { watchVault } from "@omnicore/core";
import { webhookCallback, type Bot } from "grammy";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { runStartupCatchUp, startBullScheduler, startLocalScheduler, type Hooks, type Scheduler } from "./queues/index.js";
import { buildHttp } from "./http.js";
import { isLoopback } from "./security.js";
import { createBot, registerCommands } from "./telegram/bot.js";
import { setMiniAppUrl } from "./telegram/format.js";
import { TelegramNotifier } from "./telegram/notifier.js";
import { runDigest } from "./ai.js";
import { checkForUpdate, newerThan, VERSION } from "./version.js";
import { ensureApiToken } from "./token.js";
import { withStoredSettings } from "./settings.js";
import { watchQuickTunnel } from "./quicktunnel.js";

async function main() {
  // Settings changed in the app are stored in the database and override .env.
  const config = loadConfig(await withStoredSettings(process.env));
  const generated = ensureApiToken(config);
  const ctx = createContext(config);
  let telegramStatus: "disabled" | "starting" | "running" | "failed" = "disabled";
  const app = await buildHttp(ctx, { telegramStatus: () => telegramStatus });
  if (generated) {
    app.log.info(`web sign-in: ${generated.created ? "created a password in" : "password is in"} ${generated.path} — on the server: cat data/api-token (or set API_TOKEN in .env)`);
  }
  if (!isLoopback(config.HOST) && !config.API_TOKEN) {
    app.log.warn(`HOST=${config.HOST} exposes the API on the network without API_TOKEN — set API_TOKEN or put Cloudflare Access in front.`);
  }

  const scan = await ctx.indexer.fullScan();
  app.log.info(`vault ${ctx.vault.root}: indexed ${scan.indexed}, removed ${scan.removed}`);
  await runStartupCatchUp(ctx);

  const watcher = watchVault(ctx.indexer, {
    usePolling: config.VAULT_POLLING,
    onIndexed: (rel, r) => r !== "unchanged" && app.log.debug(`watch: ${rel} → ${r}`),
  });

  // --- Telegram ---
  let bot: Bot | undefined;
  const hooks: Hooks = {};
  if (config.TELEGRAM_BOT_TOKEN) {
    if (!config.TELEGRAM_ALLOWED_USER_IDS.length) {
      app.log.warn("TELEGRAM_ALLOWED_USER_IDS is empty — the bot will only tell users their id. Reminders are disabled.");
    }
    setMiniAppUrl(config.PUBLIC_URL ? `${config.PUBLIC_URL}/tg` : undefined);
    if (config.PUBLIC_URL && !config.PUBLIC_URL.startsWith("https://")) app.log.warn("PUBLIC_URL must be https:// for the Telegram Mini App; buttons disabled.");
    bot = createBot(ctx);
    const flavor = config.AI_NAG_VARIATION && ctx.ai.local ? { db: ctx.db, ai: ctx.ai, nag: ctx.nag } : undefined;
    const notifier = new TelegramNotifier(bot, config.TELEGRAM_ALLOWED_USER_IDS, flavor);
    if (config.TELEGRAM_ALLOWED_USER_IDS.length) hooks.notifier = notifier;
  } else {
    app.log.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot and nag reminders are disabled.");
  }

  // Morning standup and evening retro: written into the daily note, and sent when Telegram is on.
  hooks.digest = async () => {
    const d = await runDigest(ctx, "standup");
    const n = hooks.notifier as TelegramNotifier | undefined;
    if (n) await n.sendDigest(ctx.db, config.TIMEZONE, d.empty ? undefined : d.text);
  };
  hooks.retro = async () => {
    const d = await runDigest(ctx, "retro");
    const n = hooks.notifier as TelegramNotifier | undefined;
    if (n && !d.empty) await n.sendRetro(d.text);
  };
  // Opt-in GitHub release check: the web app shows "Update available", Telegram gets one message per release.
  let updateTimer: NodeJS.Timeout | undefined;
  if (config.UPDATE_CHECK_REPO) {
    let told = "";
    const check = async () => {
      const latest = await checkForUpdate(config.UPDATE_CHECK_REPO!, config.GITHUB_API_ROOT);
      if (latest && newerThan(latest.version, VERSION.version) && told !== latest.version) {
        told = latest.version;
        app.log.info(`update available: ${VERSION.version} → ${latest.version} (${latest.url}) — run scripts/update.sh`);
        const n = hooks.notifier as TelegramNotifier | undefined;
        await n?.sendText(`⬆️ <b>OmniCore ${latest.version}</b> is available (you have ${VERSION.version}).\nOn the server: <code>scripts/update.sh</code>`).catch(() => {});
      }
    };
    setTimeout(() => void check(), 15_000).unref();
    updateTimer = setInterval(() => void check(), config.UPDATE_CHECK_HOURS * 3_600_000);
    updateTimer.unref();
  }
  app.log.info(`OmniCore ${VERSION.version}${VERSION.sha ? ` (${VERSION.sha.slice(0, 7)})` : ""}`);
  const ai = ctx.ai.status();
  app.log.info(
    ai.enabled
      ? `ai: ${ai.local ? `local ${ai.local.provider} (${ai.local.chatModel}, ${ai.local.embedModel}${ai.local.visionModel ? `, ${ai.local.visionModel}` : ""})` : "no local model"}` +
          `${ai.cloud ? `; cloud ${ai.cloud.provider}/${ai.cloud.model} (${ai.cloud.mode})` : "; cloud off"}` +
          `; speech-to-text ${ai.speechToText ? "on" : "off"}; vectors ${ctx.semantic?.engine ?? "off"}`
      : "ai: off (AI_PROVIDER=none and no cloud)",
  );

  const scheduler: Scheduler = config.REDIS_URL
    ? await startBullScheduler(ctx, hooks, config.REDIS_URL)
    : startLocalScheduler(ctx, hooks);
  app.log.info(`scheduler: ${config.REDIS_URL ? "BullMQ" : "in-process timers (REDIS_URL not set)"}`);

  // Telegram problems (bad token, no network) must not take the API down.
  const startTelegram = async (b: Bot) => {
    if (config.TELEGRAM_WEBHOOK_URL) {
      const secret = config.TELEGRAM_WEBHOOK_SECRET ?? randomBytes(24).toString("hex");
      await b.init();
      await b.api.setWebhook(config.TELEGRAM_WEBHOOK_URL, { secret_token: secret, allowed_updates: ["message", "callback_query"] });
      app.log.info(`telegram: webhook at ${new URL(config.TELEGRAM_WEBHOOK_URL).pathname}`);
      return secret;
    }
    await b.api.deleteWebhook();
    b.start({ allowed_updates: ["message", "callback_query"], onStart: (me) => app.log.info(`telegram: polling as @${me.username}`) }).catch(
      (e) => app.log.error(`telegram polling stopped: ${e}`),
    );
    return undefined;
  };
  if (bot) {
    try {
      telegramStatus = "starting";
      const secret = await startTelegram(bot);
      telegramStatus = "running";
      if (secret) app.post(new URL(config.TELEGRAM_WEBHOOK_URL!).pathname, webhookCallback(bot, "fastify", { secretToken: secret }));
      await registerCommands(bot).catch((e) => app.log.warn(`setMyCommands failed: ${e}`));
    } catch (e) {
      app.log.error(`telegram: failed to start (${e}). The API keeps running; fix the token/network and restart.`);
      hooks.notifier = undefined;
      telegramStatus = "failed";
    }
  }

  // Quick tunnel: pick up its random https address for the Mini App, and tell the user.
  if (config.QUICK_TUNNEL_METRICS && !config.PUBLIC_URL) {
    watchQuickTunnel(config.QUICK_TUNNEL_METRICS, async (url) => {
      app.log.info(`quick tunnel: ${url} (a new address each time the tunnel restarts)`);
      setMiniAppUrl(`${url}/tg`);
      if (bot && telegramStatus === "running") await registerCommands(bot).catch((e) => app.log.warn(`setChatMenuButton failed: ${e}`));
      const n = hooks.notifier as TelegramNotifier | undefined;
      await n
        ?.sendText(
          `📱 <b>The app is online</b>\n${url}\n\nOpen it with the <b>Open</b> button next to the message box, or in any browser (password: <code>cat data/api-token</code> on the server).\n<i>This is a temporary address; if it changes I'll send the new one.</i>`,
        )
        .catch(() => {});
    });
  }

  const shutdown = async (sig: string) => {
    app.log.info(`${sig} received, shutting down`);
    if (bot?.isRunning()) await bot.stop();
    await app.close();
    await watcher.close();
    await scheduler.close();
    ctx.db.$client.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`bound to ${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
