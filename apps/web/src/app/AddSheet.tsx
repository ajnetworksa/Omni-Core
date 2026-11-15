import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, Flag, FolderOpen, Repeat } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, refreshAll } from "../lib/api";
import { dayLabel } from "../lib/format";
import type { Parsed } from "../lib/types";
import { haptic } from "../tg/telegram";
import { suggestFor } from "../tg/suggest";
import { useBack, usePlatform, usePrimary } from "./platform";
import { Sheet, useToast } from "./ui";

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

export function AddSheet({ onClose, project }: { onClose: () => void; project?: { slug: string; title: string } }) {
  const { tg } = usePlatform();
  const toast = useToast();
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
      const { tasks } = await api.createMany(text.trim(), project?.slug);
      haptic.ok();
      await refreshAll();
      onClose();
      const first = tasks[0]!;
      toast.show({
        text: tasks.length > 1 ? `Added ${tasks.length} tasks` : `Added: ${first.title}`,
        undo: async () => {
          let r = await api.deleteTask(first.id);
          for (const t of tasks.slice(1)) r = await api.deleteTask(t.id);
          return r;
        },
      });
    } catch {
      haptic.err();
      setError("Couldn't save it. Check the connection and try again.");
    } finally {
      tg?.MainButton.hideProgress();
    }
  }, [text, tg, onClose, project, toast]);

  const many = parsed?.items && parsed.items.length > 1 ? parsed.items : null;
  const addLabel = many ? `Add ${many.length} tasks${project ? ` to ${project.title}` : ""}` : project ? `Add to ${project.title}` : "Add task";
  usePrimary({ label: addLabel, onClick: () => void submit(), enabled: !!text.trim() }, [text, submit, addLabel]);
  useBack(onClose);

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
    <Sheet title="New task" onClose={onClose} side={project && <span className="text-[13px] font-medium" style={{ color: "var(--tg-link)" }}>in {project.title}</span>}>
        <label htmlFor="tg-add" className="sr-only">Task</label>
        <textarea
          id="tg-add"
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (suggestions[0] && word) { const s = suggestions[0]; if (s.pickDate) dateRef.current?.showPicker?.(); else replaceWord(s.insert); } else void submit(); }
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

        {many && (
          <div className="flex flex-col gap-1 rounded-[12px] px-3.5 py-2.5" style={{ background: "var(--tg-accent-soft)" }} aria-label="Tasks to add">
            <span className="text-[13px] font-semibold" style={{ color: "var(--tg-link)" }}>{`Adds ${many.length} separate tasks:`}</span>
            <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5 text-[14px]">
              {many.map((t, i) => <li key={i} className="truncate">{t || <i style={{ color: "var(--tg-hint)" }}>(empty)</i>}</li>)}
            </ol>
          </div>
        )}
        <div className="flex min-h-[26px] flex-wrap items-center gap-1.5">
          {many ? (
            <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>Each task keeps its own @date, !priority and #tags.</span>
          ) : chips.length > 0 ? (
            <>
              <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>Saved as</span>
              {parsed?.title && <span className="max-w-[60%] truncate text-[13px] font-semibold">{parsed.title}</span>}
              {chips.map((c) => (
                <span key={c.k} className="rounded-full px-2.5 py-0.5 text-[12.5px] font-medium" style={{ background: "var(--tg-chip)", color: "var(--tg-fg-2)" }}>{c.v}</span>
              ))}
            </>
          ) : (
            <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>
              Just type what needs doing. To add a date, priority or project, tap a chip above (or type <b>@</b>, <b>!</b> or <b>#</b>). Several at once: <b>1. … 2. …</b> or one per line (Shift+Enter).
            </span>
          )}
        </div>
        {error && <p className="m-0 text-[13px]" style={{ color: "var(--tg-danger)" }}>{error}</p>}
        {!tg && (
          <button type="button" disabled={!text.trim()} onClick={() => void submit()} className="h-[52px] rounded-[14px] text-[16px] font-semibold disabled:opacity-50" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>
            {addLabel}
          </button>
        )}
    </Sheet>
  );
}
