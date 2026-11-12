// Starts server + mock Telegram on a demo vault, creates realistic activity, keeps running.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { client, freshDir, ROOT, sleep, startServer } from "../tests/lib/harness.mjs";
import { callbackUpdate, startMockTelegram, textUpdate } from "../tests/lib/mock-telegram.mjs";
import { seedVault } from "../tests/lib/seed.mjs";
import { startMockAi } from "../tests/lib/mock-ai.mjs";

const TZ = "Asia/Riyadh", ME = 111, TOKEN = "4242:DEMO", API_TOKEN = "demo-token-0123456789abcdef";
const RUN = freshDir(join(ROOT, "demo/ui-run"));
const VAULT = join(RUN, "vault");
seedVault(VAULT, TZ);
writeFileSync(join(VAULT, "projects/Core switch decision.md"), "# Core switch decision\n\n## Why\nWe decided to replace the core switch with a Cisco SG350 because the old one drops VLAN config after firmware updates.\n\n## Vendors considered\nJuniper EX was over budget; the SG350 fits and has PoE for the access points.\n");
// Stand-in local model (deterministic) — a real install uses Ollama.
const ai = await startMockAi({ port: 3972, demo: true });
const tg = await startMockTelegram({ port: 3971, token: TOKEN });
const srv = await startServer({
  port: 3970, logFile: join(RUN, "server.log"),
  env: { VAULT_PATH: VAULT, DATABASE_PATH: join(RUN, "app.db"), TIMEZONE: TZ, API_TOKEN, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ALLOWED_USER_IDS: String(ME),
    TELEGRAM_API_ROOT: tg.url, NAG_TICK_SECONDS: "15", NAG_QUIET_HOURS: "", NAG_DEFAULT_DUE_TIME: "00:00", REINDEX_INTERVAL_MINUTES: "0", DIGEST_TIME: "", RETRO_TIME: "",
    OLLAMA_BASE_URL: ai.url, STT_BASE_URL: `${ai.url}/v1`, AI_VISION_MODEL: "llama3.2-vision" },
});
const api = client(srv.base, API_TOKEN);
const find = async (t) => (await api.get("/api/tasks?limit=2000")).json.find((x) => x.title === t);
// activity
tg.inject(textUpdate(tg, ME, "/todo Replace UPS battery !p1 @today 18:00 #project/homelab"));
tg.inject(textUpdate(tg, ME, "Router rebooted after power blip, all VLANs back up"));
await api.post("/api/tasks", { text: "Order spare PSU !p2 @tomorrow 10:00 #project/homelab" });
await api.post("/api/tasks", { text: "Book dentist @+3d" });
await api.post("/api/tasks", { text: "Read Proxmox HA docs" });
await sleep(1200);
const sfp = await find("Order SFP modules");
await api.post(`/api/tasks/${sfp.id}/remarks`, { text: "Waiting for supplier quote" });
await sleep(17000); // one nag tick → reminders + history
const vlan = await find("Migrate VLANs");
await api.post(`/api/tasks/${vlan.id}/remarks`, { text: "Waiting for change-window approval from ops" });
const doc = await find("Document IP plan");
await api.post(`/api/tasks/${doc.id}/actions/p50`);
const isp = await find("Call ISP about outage");
await api.post(`/api/tasks/${isp.id}/actions/done`);
await api.post("/api/ai/reindex");
writeFileSync(join(RUN, "ready"), JSON.stringify({ base: srv.base, token: API_TOKEN, bot: TOKEN }));
console.log("READY", srv.base);
process.on("SIGTERM", async () => { await srv.stop(); await tg.close(); await ai.close(); process.exit(0); });
setInterval(() => {}, 1 << 30);
