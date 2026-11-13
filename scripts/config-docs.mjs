// Regenerates docs/CONFIGURATION.md from apps/server/src/config.ts (the single source of truth
// for settings). Run after adding or changing a setting:  node scripts/config-docs.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "apps/server/src/config.ts"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
const body = src.slice(src.indexOf("const Env = z.object({"), src.indexOf("\n});", src.indexOf("const Env = z.object({")));

const rows = [];
let section = "Core";
let comment = [];
const lines = body.split("\n").slice(1);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const sec = line.match(/^\s*\/\/ -{2,3}\s*(.+?)\s*-{0,3}\s*$/);
  if (sec) { section = sec[1].replace(/\(.*?\)/, "").trim(); comment = []; continue; }
  const one = line.match(/^\s*\/\*\*\s*(.+?)\s*\*\/\s*$/);
  if (one) { comment.push(one[1]); continue; }
  if (/^\s*\/\*\*/.test(line)) {
    const buf = [line.replace(/^\s*\/\*\*\s?/, "")];
    while (!/\*\//.test(lines[i])) buf.push(lines[++i].replace(/^\s*\*\s?/, ""));
    comment.push(buf.join(" ").replace(/\*\/\s*$/, "").trim());
    continue;
  }
  const key = line.match(/^\s{2}([A-Z][A-Z0-9_]+):\s*(.*)$/);
  if (!key) { if (line.trim() && !line.trim().startsWith("//")) continue; comment = line.trim() ? comment : []; continue; }
  // Gather the whole expression (until the next key or comment at the same indent).
  let expr = key[2];
  while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) expr += " " + lines[++i].trim();
  const def = expr.match(/\.default\(\s*("([^"]*)"|[^)]+)\)/);
  const boolDef = expr.match(/bool\((true|false)\)/);
  const enumv = expr.match(/z\.enum\(\[([^\]]+)\]\)/);
  rows.push({
    section,
    key: key[1],
    def: boolDef ? boolDef[1] : def ? (def[2] ?? def[1]).trim() : "",
    values: enumv ? enumv[1].replace(/"/g, "").split(",").map((s) => s.trim()).join(" · ") : "",
    doc: comment.join(" "),
    inExample: new RegExp(`^#?\\s*${key[1]}=`, "m").test(envExample),
  });
  comment = [];
}

const bySection = new Map();
for (const r of rows) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r]);
const esc = (s) => s.replace(/\|/g, "\\|");
let out = `# Configuration\n\nEvery setting is an environment variable, normally set in \`.env\` (copy \`.env.example\`).\nThe everyday ones (reminders, quiet hours, summaries, time zone, weekend…) can also be changed in the app under **Settings**; those are stored in the database and override \`.env\`.\nThis file is generated from \`apps/server/src/config.ts\` by \`node scripts/config-docs.mjs\`; don't edit it by hand.\n\nInvalid values stop the server at startup with a message naming the setting.\n`;
for (const [sec, list] of bySection) {
  out += `\n## ${sec}\n\n| Setting | Default | What it does |\n|---|---|---|\n`;
  for (const r of list) {
    const def = r.def === "" ? "—" : `\`${esc(r.def)}\``;
    const what = [r.doc, r.values && `One of: ${r.values}.`].filter(Boolean).join(" ") || "—";
    out += `| \`${r.key}\` | ${def} | ${esc(what)} |\n`;
  }
}
out += `\n## Docker-only\n\n| Setting | Default | What it does |\n|---|---|---|\n| \`OMNICORE_IMAGE\` | — | Use a prebuilt image (e.g. \`ghcr.io/<owner>/<repo>:latest\`) instead of building on the server. \`scripts/update.sh\` then pulls it. |\n| \`COMPOSE_PROFILES\` | — | Extras to run, comma-separated: \`ai\` (bundled Ollama; the app points at it and downloads the models), \`quicktunnel\` (instant trycloudflare.com https address; sets the Mini App button), \`tunnel\` (Cloudflare Tunnel on your domain), \`redis\` (Redis scheduler; the app points at it). |\n| \`LISTEN\` | \`127.0.0.1\` | Address the web port is published on; \`0.0.0.0\` opens it to your local network. |\n| \`PUID\` / \`PGID\` | owner of \`vault/\`, else \`1000\` | The user the app runs as inside the container; owns \`data/\` and \`vault/\`. |\n| \`CLOUDFLARE_TUNNEL_TOKEN\` | — | Token for the \`tunnel\` extra. |\n\n## Update script (\`scripts/update.sh\`)\n\n| Variable | Default | What it does |\n|---|---|---|\n| \`OMNICORE_MODE\` | auto | \`docker\`, \`image\` or \`node\`. |\n| \`OMNICORE_URL\` | \`http://127.0.0.1:$PORT\` | Where to check \`/health\`. |\n| \`OMNICORE_SERVICE\` | \`omnicore\` | systemd unit / pm2 name in node mode. |\n| \`OMNICORE_RESTART_CMD\`, \`OMNICORE_STOP_CMD\` | — | Custom restart/stop commands in node mode. |\n| \`OMNICORE_HEALTH_TIMEOUT\` | \`120\` | Seconds to wait for the new version to answer. |\n`;
writeFileSync(join(root, "docs/CONFIGURATION.md"), out);
const missing = rows.filter((r) => !r.inExample && !["NODE_ENV", "TELEGRAM_API_ROOT", "GITHUB_API_ROOT", "WEB_DIST"].includes(r.key)).map((r) => r.key);
console.log(`docs/CONFIGURATION.md: ${rows.length} settings in ${bySection.size} sections${missing.length ? `; not in .env.example: ${missing.join(", ")}` : ""}`);
