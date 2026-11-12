import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { aiErrorText, api, refreshAll } from "../lib/api";
import type { TaskDetail } from "../lib/types";
import { haptic } from "./telegram";

/** Mini App version of "Break down": suggestions you tick, then add. */
export function TgBreakdown({ task }: { task: TaskDetail }) {
  const ai = useQuery({ queryKey: ["ai"], queryFn: api.ai, staleTime: 60_000 });
  const [items, setItems] = useState<{ text: string; on: boolean }[] | null>(null);
  const suggest = useMutation({
    mutationFn: () => api.breakdown(task.id),
    onSuccess: (r) => {
      haptic.ok();
      setItems(r.subtasks.map((text) => ({ text, on: true })));
    },
    onError: () => haptic.err(),
  });
  const add = useMutation({
    mutationFn: (titles: string[]) => api.addSubtasks(task.id, titles),
    onSuccess: () => {
      haptic.ok();
      setItems(null);
      void refreshAll();
    },
  });
  if (!ai.data?.features.breakdown || !task.notePath || task.status === "done" || task.parentTaskId) return null;
  const chosen = (items ?? []).filter((i) => i.on).map((i) => i.text);

  if (!items) {
    return (
      <div className="px-1">
        <button type="button" onClick={() => { haptic.tap(); suggest.mutate(); }} disabled={suggest.isPending} className="inline-flex items-center gap-2 text-[15px] font-medium disabled:opacity-70" style={{ color: "var(--tg-link)" }}>
          <Sparkles size={16} aria-hidden />
          {suggest.isPending ? "Thinking of steps…" : task.children.length ? "Suggest more steps" : "Break it into steps"}
        </button>
        {suggest.isError && <p className="m-0 mt-1 text-[13px]" style={{ color: "var(--tg-danger)" }} role="alert">{aiErrorText(suggest.error)}</p>}
      </div>
    );
  }
  return (
    <section aria-label="Suggested steps" className="flex flex-col rounded-[18px] px-4 py-3" style={{ background: "var(--tg-section)" }}>
      <div className="pb-1 font-display text-[15px] font-bold">Suggested steps</div>
      {items.map((it, i) => (
        <label key={i} className="flex items-center gap-3 py-2.5 text-[15.5px]" style={{ borderTop: i ? "1px solid var(--tg-sep)" : undefined }}>
          <input type="checkbox" checked={it.on} onChange={(e) => { haptic.tap(); setItems(items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x))); }} className="h-5 w-5" style={{ accentColor: "var(--tg-accent)" }} />
          <span style={it.on ? undefined : { color: "var(--tg-hint)", textDecoration: "line-through" }}>{it.text}</span>
        </label>
      ))}
      <div className="flex gap-2 pt-2">
        <button type="button" disabled={!chosen.length || add.isPending} onClick={() => add.mutate(chosen)} className="h-10 flex-1 rounded-full text-[14.5px] font-medium disabled:opacity-50" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>
          {add.isPending ? "Adding…" : `Add ${chosen.length}`}
        </button>
        <button type="button" onClick={() => setItems(null)} className="h-10 rounded-full px-4 text-[14.5px]" style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)" }}>
          Cancel
        </button>
      </div>
    </section>
  );
}
