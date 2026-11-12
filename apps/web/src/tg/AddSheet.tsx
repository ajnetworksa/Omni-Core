import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, Flag, FolderOpen, Repeat } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, refreshAll } from "../lib/api";
import { dayLabel } from "../lib/format";
import type { Parsed } from "../lib/types";
import { suggestFor } from "./suggest";
import { haptic, type TgWebApp } from "./telegram";

/**
 * New task sheet. Type freely; the word you're typing gets suggestions:
 *   @  dates      !  priority      #  projects and tags      9 / 18:3  times      every  repeats
 * The chips under the box insert the trigger for you, so nothing has to be remembered.
 */

/** The word right before the cursor ("" after a space). */
function wordAt(text: string, caret: number) {
  const before = text.slice(0, caret);
  // "every w…" is one phrase, so "every week" can be finished in place.
  const m = before.match(/(?:^|\s)(every \S*)$/i) ?? before.match(/(\S+)$/);
  return m ? { word: m[1]!, start: caret - m[1]!.length } : { word: "", start: caret };
}

export function AddSheet({ tg, onClose, project }: { tg: TgWebApp | null; onClose: () => void; project?: { slug: string; title: string } }) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState("");
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const sug = useQuery({ queryKey: ["suggest"], queryFn: api.suggest, staleTime: 30_000 });
  const ref = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  /** Where the cursor goes after a suggestion or chip edits the text (set before the next paint). */
  const caretAfter = useRef<number | null>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useLayoutEffect(() => {
    const pos = caretAfter.current;
    if (pos === null || !ref.current) return;
    caretAfter.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(pos, pos);
  }, [text]);

  useEffect(() => {
    if (!text.trim()) return setParsed(null);
    const id = setTimeout(() => api.parse(text).then(setParsed, () => setParsed(null)), 180);
    return () => clearTimeout(id);
  }, [text]);

  const { word, start } = wordAt(text, caret);
  const suggestions = useMemo(
    () => (today.data ? suggestFor(word, { today: today.data.date, projects: project ? [] : sug.data?.projects ?? [], tags: sug.data?.tags ?? [] }) : []),
    [word, today.data, sug.data, project],
  );

  const replaceWord = useCallback((insert: string) => {
    const next = `${text.slice(0, start)}${insert} ${text.slice(caret).replace(/^\s+/, "")}`;
    const pos = start + insert.length + 1;
    caretAfter.current = pos;
    setText(next);
    setCaret(pos);
    haptic.tap();
  }, [text, start, caret]);

  /** Chip: start a token (" @", " !" …) at the end so its suggestions show. */
  const startToken = (t: string) => {
    const base = text.replace(/\s+$/, "");
    const next = `${base}${base ? " " : ""}${t}`;
    caretAfter.current = next.length;
    setText(next);
    setCaret(next.length);
  };

  const submit = useCallback(async () => {
    if (!text.trim()) return;
    setError("");
    tg?.MainButton.showProgress();
    try {
      await api.createIn(text.trim(), project?.slug);
      haptic.ok();
      await refreshAll();
      onClose();
    } catch {
      haptic.err();
      setError("Couldn't save it. Check the connection and try again.");
    } finally {
      tg?.MainButton.hideProgress();
    }
  }, [text, tg, onClose, project]);

  useEffect(() => {
    if (!tg) return;
    tg.MainButton.setText(project ? `Add to ${project.title}` : "Add task").show();
    if (text.trim()) tg.MainButton.enable(); else tg.MainButton.disable();
    tg.MainButton.onClick(submit);
    tg.BackButton.show();
    tg.BackButton.onClick(onClose);
    return () => { tg.MainButton.offClick(submit); tg.BackButton.offClick(onClose); tg.BackButton.hide(); };
  }, [tg, submit, onClose, text, project]);

  const chips = parsed
    ? [
        parsed.dueDate && today.data ? { k: "date", v: `${dayLabel(parsed.dueDate, today.data.date)}${parsed.dueTime ? ` · ${parsed.dueTime}` : ""}` } : null,
        parsed.priority && parsed.priority < 4 ? { k: "pri", v: ["", "Urgent", "High", "Medium"][parsed.priority]! } : null,
        parsed.recurrence ? { k: "rep", v: `🔁 ${parsed.recurrence}` } : null,
        project ? { k: "proj", v: project.title } : parsed.project ? { k: "proj", v: parsed.project } : null,
        ...parsed.tags.filter((t) => !t.startsWith("project/")).map((t) => ({ k: `t${t}`, v: `#${t}` })),
      ].filter((c): c is { k: string; v: string } => !!c)
    : [];

  const tools: [string, string, typeof CalendarDays][] = [["@", "Date", CalendarDays], ["", "Time", Clock], ["!", "Priority", Flag], ...(project ? [] : [["#project/", "Project", FolderOpen] as [string, string, typeof CalendarDays]]), ["every", "Repeat", Repeat]];

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end" style={{ background: "rgba(20,20,24,.35)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="New task" className="anim-in flex flex-col gap-3 rounded-t-[24px] px-5 pb-5 pt-3" style={{ background: "var(--tg-section)", boxShadow: "0 -8px 30px rgba(0,0,0,.12)" }}>
        <div className="mx-auto h-1 w-10 rounded-full" style={{ background: "var(--tg-check)" }} aria-hidden />
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 font-display text-[19px] font-extrabold tracking-tight">New task</h2>
          {project && <span className="text-[13px] font-medium" style={{ color: "var(--tg-link)" }}>in {project.title}</span>}
        </div>
        <label htmlFor="tg-add" className="sr-only">Task</label>
        <textarea
          id="tg-add"
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => { setText(e.target.value.replace(/\n/g, " ")); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (suggestions[0] && word) { const s = suggestions[0]; if (s.pickDate) dateRef.current?.showPicker?.(); else replaceWord(s.insert); } else void submit(); }
          }}
          placeholder="What needs doing?"
          className="resize-none rounded-[14px] px-3.5 py-3 text-[16.5px] leading-snug outline-none"
          style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)", boxShadow: "inset 0 0 0 1.5px transparent" }}
          onFocus={(e) => (e.currentTarget.style.boxShadow = "inset 0 0 0 1.5px var(--tg-accent)")}
          onBlur={(e) => (e.currentTarget.style.boxShadow = "inset 0 0 0 1.5px transparent")}
        />

        {suggestions.length > 0 ? (
          <div role="listbox" aria-label="Suggestions" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                role="option"
                aria-selected={false}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (s.pickDate ? dateRef.current?.showPicker?.() ?? dateRef.current?.click() : replaceWord(s.insert))}
                className="flex flex-none flex-col items-start rounded-[12px] px-3 py-2 text-left"
                style={{ background: "var(--tg-accent-soft)", color: "var(--tg-link)" }}
              >
                <span className="text-[14px] font-semibold leading-tight">{s.label}</span>
                {s.hint && <span className="text-[11.5px] leading-tight" style={{ color: "var(--tg-hint)" }}>{s.hint}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {tools.map(([t, label, Icon]) => (
              <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (label === "Time" ? startToken(String(new Date().getHours() + 1 > 23 ? 9 : new Date().getHours() + 1)) : startToken(t))} className="flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-[14px] font-medium" style={{ background: "var(--tg-chip)", color: "var(--tg-fg)" }}>
                <Icon size={15} aria-hidden style={{ color: "var(--tg-hint)" }} />
                {label}
              </button>
            ))}
          </div>
        )}
        <input
          ref={dateRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          min={today.data?.date}
          onChange={(e) => e.target.value && replaceWord(`📅 ${e.target.value}`)}
        />

        <div className="flex min-h-[26px] flex-wrap items-center gap-1.5">
          {chips.length > 0 ? (
            <>
              <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>Saved as</span>
              {parsed?.title && <span className="max-w-[60%] truncate text-[13px] font-semibold">{parsed.title}</span>}
              {chips.map((c) => (
                <span key={c.k} className="rounded-full px-2.5 py-0.5 text-[12.5px] font-medium" style={{ background: "var(--tg-chip)", color: "var(--tg-fg-2)" }}>{c.v}</span>
              ))}
            </>
          ) : (
            <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>
              Type <b>@</b> for a date, <b>!</b> for priority, <b>#</b> for a project — or tap a chip.
            </span>
          )}
        </div>
        {error && <p className="m-0 text-[13px]" style={{ color: "var(--tg-danger)" }}>{error}</p>}
        {!tg && (
          <button type="button" disabled={!text.trim()} onClick={() => void submit()} className="h-[52px] rounded-[14px] text-[16px] font-semibold disabled:opacity-50" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>
            {project ? `Add to ${project.title}` : "Add task"}
          </button>
        )}
      </div>
    </div>
  );
}
