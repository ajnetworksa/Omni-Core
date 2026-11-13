import { AppLink as Link } from "../app/platform";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { aiErrorText, api, ApiError, refreshAll } from "../lib/api";
import type { TodayBoard } from "../lib/types";

/** Right rail: today's daily-note log (what you captured from Telegram or here) + nag summary. */
export function DailyNote({ board }: { board: TodayBoard }) {
  const note = useQuery({
    queryKey: ["note-path", board.dailyNotePath],
    queryFn: () => api.noteByPath(board.dailyNotePath).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config", { credentials: "same-origin" }).then((r) => r.json()) });
  const [text, setText] = useState("");
  const logLines = (note.data?.content ?? "").split(/\r?\n/);
  const logStart = logLines.findIndex((l) => /^#{1,6}\s+log\s*$/i.test(l));
  const entries = logStart < 0 ? [] : logLines.slice(logStart + 1).filter((l) => /^- /.test(l)).map((l) => l.slice(2));
  const section = (name: string) => {
    const i = logLines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, "i").test(l));
    if (i < 0) return null;
    const out: string[] = [];
    for (const l of logLines.slice(i + 1)) {
      if (/^#{1,2}\s/.test(l)) break;
      out.push(l);
    }
    return out.join("\n").trim() || null;
  };
  const standup = section("Standup");
  const retro = section("Retro");
  const evening = new Date().getHours() >= 16;
  const digest = useMutation({ mutationFn: (kind: "standup" | "retro") => api.digest(kind), onSuccess: () => void refreshAll() });
  const shown = evening && retro ? { kind: "Retro", text: retro } : standup ? { kind: "Standup", text: standup } : retro ? { kind: "Retro", text: retro } : null;
  const want: "standup" | "retro" = evening ? "retro" : "standup";
  const next = [...board.attention, ...board.later].filter((t) => t.nag?.nextAt).sort((a, b) => a.nag!.nextAt!.localeCompare(b.nag!.nextAt!))[0];

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api.log(text);
    setText("");
    await refreshAll();
  };

  return (
    <aside aria-label="Daily note" className="flex flex-col gap-4 border-line bg-panel px-5 py-7 lg:w-[320px] lg:flex-none lg:border-l">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold">Daily note</h2>
        {note.data ? (
          <Link to={`/notes/${note.data.id}`} className="font-mono text-[11px] text-faint hover:text-accent-soft">
            {board.dailyNotePath}
          </Link>
        ) : (
          <span className="font-mono text-[11px] text-faint">{board.dailyNotePath}</span>
        )}
      </div>
      <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
        {entries.length === 0 && <p className="m-0 text-faint">Nothing logged yet. Anything you send the bot lands here.</p>}
        {entries.map((e, i) => {
          const m = e.match(/^(\d{2}:\d{2})\s+(.*)$/);
          return (
            <div key={i} className="flex gap-2.5">
              <span className="flex-none font-mono text-xs text-faint">{m?.[1] ?? ""}</span>
              <span className="text-fg-2">{(m?.[2] ?? e).replace(/!\[\[(.+?)\]\]/g, "[attachment]")}</span>
            </div>
          );
        })}
      </div>
      <form onSubmit={add}>
        <label htmlFor="log-input" className="sr-only">Add to today's log</label>
        <input
          id="log-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Log something…"
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
        />
      </form>
      <section aria-label="Summary" className="flex flex-col gap-2">
        {shown && (
          <div className="rounded-[10px] border border-line bg-card px-3.5 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-faint">{shown.kind}</div>
            <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-2">{shown.text}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => digest.mutate(want)}
          disabled={digest.isPending}
          className="inline-flex items-center gap-1.5 self-start rounded-lg px-1 py-0.5 text-[12.5px] text-muted hover:text-fg disabled:opacity-70"
        >
          <Sparkles size={13} className="text-accent" aria-hidden />
          {digest.isPending ? "Writing…" : `${(want === "retro" ? retro : standup) ? "Rewrite" : "Write"} ${want === "retro" ? "today's retro" : "standup"}`}
        </button>
        {digest.isError && <p className="m-0 text-xs text-warn" role="alert">{aiErrorText(digest.error)}</p>}
        {digest.data?.empty && <p className="m-0 text-xs text-faint">Nothing to summarise yet.</p>}
      </section>
      <div className="h-px bg-line" />
      <h2 className="m-0 text-[13px] font-semibold">Nag engine</h2>
      {config.data && (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-[12.5px] text-fg-2">
          <dt>Overdue</dt><dd className="m-0 text-fg">{`every ${config.data.nag.intervals.overdue} min`}</dd>
          <dt>Partial</dt><dd className="m-0 text-fg">{`every ${config.data.nag.intervals.partial} min`}</dd>
          <dt>Remark / blocked</dt><dd className="m-0 text-fg">{`every ${config.data.nag.intervals.remark} min`}</dd>
          <dt>Quiet hours</dt><dd className="m-0 text-fg">{config.data.nag.quietHours || "off"}</dd>
        </dl>
      )}
      {next && (
        <div className="rounded-[10px] border border-line bg-[var(--tg-accent-soft)] p-3 text-[12.5px] leading-relaxed text-fg-2">
          Next nudge: <b className="text-fg">{next.title}</b>
          {new Date(next.nag!.nextAt!).getTime() <= Date.now() ? " · due now (queued)" : ` · ${new Date(next.nag!.nextAt!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
        </div>
      )}
    </aside>
  );
}
