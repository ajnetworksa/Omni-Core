// Realistic demo vault. Dates are relative to "today" in the configured timezone.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { localDate } from "./harness.mjs";

export function seedVault(vault, tz) {
  const d = (n) => localDate(tz, n);
  const today = d(0), yesterday = d(-1), minus3 = d(-3), plus1 = d(1), plus3 = d(3);
  const files = {
    "projects/homelab.md": `---
project: Homelab
tags: [infra]
---
# Homelab

Topology lives in [[Network Map]]; vendor notes in [[Vendors#Juniper]].

## Tasks
- [ ] Replace core switch !p1 📅 ${today} 00:30 #network
  - [x] Compare vendors
  - [ ] Order SFP modules
  - [ ] Schedule maintenance window
- [!] Migrate VLANs 📅 ${yesterday} #network
- [ ] Backup NAS 🔁 every week 📅 ${today} 00:20 #backup
- [/] Document IP plan 📅 ${today} 00:15
- [ ] Renew TLS certs 📅 ${plus3}
- [x] Install UPS ✅ ${minus3}

\`\`\`md
- [ ] this is an example inside a code fence, not a task
\`\`\`
`,
    "projects/website.md": `---
project: Website Redesign
---
# Website Redesign

- [ ] Draft homepage copy !p2 📅 ${minus3}
- [ ] Pick colour palette 📅 ${plus1} #design
- [-] Old landing page idea
`,
    "Network Map.md": `# Network Map

Core: see [[homelab]]. Still to write: [[Missing Page]].
`,
    "Vendors.md": `# Vendors

## Juniper
EX series quotes pending.
`,
    [`daily/${yesterday}.md`]: `---
created: ${yesterday}
tags: [daily]
---

## Tasks
- [ ] Call ISP about outage 📅 ${yesterday} 00:10

## Log
- 09:00 Router rebooted after power blip
`,
    "inbox/ideas.md": "# Ideas\r\n\r\n- [ ] Try Proxmox Backup Server\r\n",
    ".obsidian/workspace.json": "{}",
    ".obsidian/plugin-note.md": "- [ ] must be ignored\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = join(vault, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return { today, yesterday, minus3, plus1, plus3, expectedNotes: 6, expectedTasks: 14 };
}
