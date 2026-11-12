import { CornerDownLeft, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, refreshAll } from "../lib/api";
import { dayLabel } from "../lib/format";
import type { Parsed } from "../lib/types";
import { Chip } from "./ui";

/** Natural-language quick add. Chips show what the server's parser understood, as you type. */
export function QuickAdd({ today, autoFocus }: { today: string; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!text.trim()) return setParsed(null);
    const id = setTimeout(() => api.parse(text).then(setParsed, () => setParsed(null)), 180);
    return () => clearTimeout(id);
  }, [text]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.create(text);
      setText("");
      setParsed(null);
      await refreshAll();
    } catch {
      setError("Couldn't add that task.");
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 rounded-[10px] border border-line-strong bg-[#11141b] px-3 py-2.5 focus-within:border-accent/60">
        <label htmlFor="quick-add" className="flex text-accent">
          <Plus size={18} strokeWidth={2.4} aria-hidden />
          <span className="sr-only">Quick add a task</span>
        </label>
        <input
          id="quick-add"
          ref={ref}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task… try “Order spare PSU !p2 @tomorrow 10:00 #project/homelab”"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          autoComplete="off"
        />
        {parsed && (
          <span className="hidden flex-wrap gap-1.5 md:flex">
            {parsed.priority && parsed.priority < 4 && <Chip tone={(["neutral", "p1", "p2", "p3"] as const)[parsed.priority]}>{`p${parsed.priority}`}</Chip>}
            {parsed.dueDate && <Chip tone="p3">{`${dayLabel(parsed.dueDate, today)}${parsed.dueTime ? ` ${parsed.dueTime}` : ""}`}</Chip>}
            {parsed.recurrence && <Chip tone="accent">{parsed.recurrence}</Chip>}
            {parsed.project && <Chip tone="info">{parsed.project}</Chip>}
            {parsed.tags.map((t) => (
              <Chip key={t}>{`#${t}`}</Chip>
            ))}
          </span>
        )}
        <button type="submit" disabled={!text.trim() || busy} className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-faint disabled:opacity-40" aria-label="Add task">
          <CornerDownLeft size={12} aria-hidden />
        </button>
      </div>
      {error && <p className="m-0 text-xs text-danger">{error}</p>}
    </form>
  );
}
