import type { ReactNode } from "react";
import type { TaskCard } from "./types";

/**
 * Small, safe markdown renderer for vault notes (no HTML passthrough): headings, paragraphs,
 * lists, task checkboxes, fenced code, [[wikilinks]], #tags, embeds. Task lines are matched to
 * indexed tasks by their ^oc- anchor so checkboxes are live.
 */
export interface MdHandlers {
  tasks: TaskCard[];
  onToggle: (t: TaskCard) => void;
  onOpenTask: (t: TaskCard) => void;
  resolveLink: (title: string) => string | null; // → note id
  onLink: (id: string) => void;
}

const TASK = /^(\s*)[-*+]\s+\[(.)\]\s+(.*)$/;

function inline(text: string, h: MdHandlers, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\])|(`[^`]+`)|((?:^|\s)#[\p{L}\p{N}_/-]+)|(\*\*[^*]+\*\*)|(\^oc-[a-z0-9]+)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) {
      const target = m[2]!.trim();
      const id = h.resolveLink(target);
      const label = m[4] ?? (m[3] ? `${target} › ${m[3]}` : target);
      if (m[1].startsWith("!")) out.push(<span key={k} className="rounded bg-[#1f2a3d] px-1.5 text-[13px] text-[#93c5fd]">{`attachment: ${target.split("/").pop()}`}</span>);
      else
        out.push(
          id ? (
            <button key={k} type="button" onClick={() => h.onLink(id)} className="text-accent-soft hover:underline">{label}</button>
          ) : (
            <span key={k} className="text-accent-soft/60" title="Note doesn't exist yet">{label}</span>
          ),
        );
    } else if (m[5]) out.push(<code key={k} className="rounded bg-raised px-1 font-mono text-[0.85em] text-[#7fd1ff]">{m[5].slice(1, -1)}</code>);
    else if (m[6]) {
      const lead = m[6].startsWith(" ") ? " " : "";
      out.push(lead, <span key={k} className="rounded-full bg-[#2d2640] px-1.5 text-[0.85em] text-[#c4b5fd]">{m[6].trim()}</span>);
    } else if (m[7]) out.push(<strong key={k}>{m[7].slice(2, -2)}</strong>);
    else if (m[8]) out.push(<span key={k} className="font-mono text-[11px] text-[#4b5263]">{m[8]}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Pull Obsidian-Tasks tokens out of a task line so reading mode shows clean chips instead. */
function taskMeta(raw: string, done: boolean) {
  let text = raw.replace(/\s*\^oc-[a-z0-9]+\s*$/, "");
  const chips: { k: string; label: string; cls: string }[] = [];
  const take = (re: RegExp, f: (m: RegExpMatchArray) => { label: string; cls: string } | null) => {
    const m = text.match(re);
    if (!m) return;
    text = text.replace(re, " ");
    const c = f(m);
    if (c) chips.push({ k: `${chips.length}`, ...c });
  };
  take(/(?:^|\s)!p([1-3])(?=\s|$)/, (m) => ({ label: `p${m[1]}`, cls: ["", "bg-[#2d1517] text-[#fca5a5]", "bg-[#2a1f12] text-[#fdba74]", "bg-[#13223a] text-[#93c5fd]"][Number(m[1])]! }));
  take(/(?:^|\s)🔁\s*(every(?:\s+[a-z0-9,]+)+?)(?=\s+(?:📅|✅|#|!p)|\s*$)/iu, (m) => ({ label: m[1]!, cls: "bg-[#211d3a] text-accent-soft" }));
  take(/(?:^|\s)📅\s?(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?(?=\s|$)/u, (m) =>
    done ? null : { label: `${new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}${m[4] ? ` ${m[4]}` : ""}`, cls: "bg-[#1a1f2b] text-fg-2" });
  take(/(?:^|\s)✅\s?\d{4}-\d{2}-\d{2}(?=\s|$)/u, () => null);
  return { text: text.replace(/\s+/g, " ").trim(), chips };
}

export function Markdown({ source, h }: { source: string; h: MdHandlers }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      const props = lines.slice(1, end).filter(Boolean);
      blocks.push(
        <dl key="fm" className="m-0 mb-4 grid grid-cols-[100px_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px]">
          {props.map((p, j) => {
            const [k, ...v] = p.split(":");
            return [<dt key={`k${j}`} className="text-muted">{k}</dt>, <dd key={`v${j}`} className="m-0 text-fg-2">{v.join(":").trim()}</dd>];
          })}
        </dl>,
      );
      i = end + 1;
    }
  }
  const byAnchor = new Map(h.tasks.filter((t) => t.anchor).map((t) => [t.anchor!, t]));
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      const start = i;
      while (++i < lines.length && !/^```/.test(lines[i]!));
      blocks.push(<pre key={`c${start}`} className="my-2 overflow-x-auto rounded-lg bg-raised px-3.5 py-2.5 font-mono text-[12.5px] text-fg-2">{lines.slice(start + 1, i).join("\n")}</pre>);
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1]!.length;
      const cls = lvl === 1 ? "text-[26px] font-bold mt-2" : lvl === 2 ? "text-lg font-semibold mt-5" : "text-base font-semibold mt-4";
      blocks.push(<div key={i} role="heading" aria-level={lvl} className={`${cls} mb-1 text-fg`}>{inline(hm[2]!, h, `h${i}`)}</div>);
      continue;
    }
    const tm = line.match(TASK);
    if (tm) {
      const anchor = tm[3]!.match(/\^(oc-[a-z0-9]+)\s*$/)?.[1];
      const t = anchor ? byAnchor.get(anchor) : undefined;
      const meta = taskMeta(tm[3]!, tm[2]! !== " " && tm[2]! !== "/" && tm[2]! !== "!");
      const ch = tm[2]!;
      const done = ch !== " " && ch !== "/" && ch !== "!";
      const indent = Math.floor(tm[1]!.replace(/\t/g, "    ").length / 2) * 18;
      const box =
        ch === "/" ? "border-[#e0a83c] text-[#e0a83c]" : ch === "!" ? "border-danger text-danger" : done ? "bg-accent border-accent text-ink" : "border-[#6b7280]";
      blocks.push(
        <div key={i} className="flex items-start gap-2.5 py-[3px]" style={{ marginLeft: indent }}>
          <button
            type="button"
            disabled={!t}
            aria-label={t ? `${done ? "Reopen" : "Complete"} ${t.title}` : "Task not indexed yet"}
            onClick={() => t && h.onToggle(t)}
            className={`mt-[3px] flex h-4 w-4 flex-none items-center justify-center rounded-[4px] border-[1.5px] text-[10px] font-bold ${box}`}
          >
            {ch === "/" ? "/" : ch === "!" ? "!" : done ? "✓" : ""}
          </button>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {t ? (
              <button type="button" onClick={() => h.onOpenTask(t)} className={`text-left hover:text-accent-soft ${done ? "text-faint line-through" : ""}`}>{inline(meta.text, h, `t${i}`)}</button>
            ) : (
              <span className={done ? "text-faint line-through" : ""}>{inline(meta.text, h, `t${i}`)}</span>
            )}
            {meta.chips.map((c) => (
              <span key={c.k} className={`rounded px-1.5 text-[11.5px] leading-5 ${c.cls}`}>{c.label}</span>
            ))}
          </span>
        </div>,
      );
      continue;
    }
    const lm = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (lm) {
      blocks.push(<div key={i} className="flex gap-2 py-[2px]" style={{ marginLeft: Math.floor(lm[1]!.length / 2) * 18 }}><span className="text-faint">•</span><span>{inline(lm[2]!, h, `l${i}`)}</span></div>);
      continue;
    }
    if (line.trim()) blocks.push(<p key={i} className="my-1.5">{inline(line, h, `p${i}`)}</p>);
  }
  return <div className="text-[15px] leading-relaxed text-[#d4d7de]">{blocks}</div>;
}
