import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { aiErrorText, api, refreshAll } from "../lib/api";
import type { TaskDetail } from "../lib/types";

/**
 * "Break down" for a task: the model proposes subtasks, you edit or untick them, and only
 * then are they written into the note under the task.
 */
export function Breakdown({ task, compact = false }: { task: TaskDetail; compact?: boolean }) {
  const ai = useQuery({ queryKey: ["ai"], queryFn: api.ai, staleTime: 60_000 });
  const [items, setItems] = useState<{ text: string; on: boolean }[] | null>(null);
  const suggest = useMutation({
    mutationFn: () => api.breakdown(task.id),
    onSuccess: (r) => setItems(r.subtasks.map((text) => ({ text, on: true }))),
  });
  const add = useMutation({
    mutationFn: (titles: string[]) => api.addSubtasks(task.id, titles),
    onSuccess: () => {
      setItems(null);
      void refreshAll();
    },
  });
  if (!ai.data?.features.breakdown || !task.notePath || task.status === "done" || task.parentTaskId) return null;
  const chosen = (items ?? []).filter((i) => i.on && i.text.trim()).map((i) => i.text.trim());

  if (!items) {
    return (
      <div>
        <button
          type="button"
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[13px] text-muted hover:border-accent hover:text-fg disabled:opacity-70 ${compact ? "" : ""}`}
        >
          <Sparkles size={14} className="text-accent" aria-hidden />
          {suggest.isPending ? "Thinking of steps…" : task.children.length ? "Suggest more subtasks" : "Break down into subtasks"}
        </button>
        {suggest.isError && <p className="m-0 mt-1.5 text-xs text-warn" role="alert">{aiErrorText(suggest.error)}</p>}
      </div>
    );
  }

  return (
    <section aria-label="Suggested subtasks" className="flex flex-col gap-2 rounded-xl border border-[#2e2a52] bg-[#14132a] p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-[#c4b5fd]">
        <Sparkles size={14} aria-hidden /> Suggested subtasks <span className="text-faint">— edit or untick before adding</span>
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={it.on}
            aria-label={`Include “${it.text}”`}
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
            className="h-4 w-4 accent-[#8b7cf6]"
          />
          <input
            value={it.text}
            aria-label={`Subtask ${i + 1}`}
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            className={`flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none focus:border-line-strong focus:bg-card ${it.on ? "text-fg" : "text-faint line-through"}`}
          />
        </div>
      ))}
      {add.isError && <p className="m-0 text-xs text-warn" role="alert">{aiErrorText(add.error)}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={!chosen.length || add.isPending} onClick={() => add.mutate(chosen)} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
          {add.isPending ? "Adding…" : `Add ${chosen.length} subtask${chosen.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" disabled={suggest.isPending} onClick={() => suggest.mutate()} className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-fg-2 hover:text-fg">
          {suggest.isPending ? "Thinking…" : "Try again"}
        </button>
        <button type="button" onClick={() => setItems(null)} className="px-2 py-1.5 text-[13px] text-muted hover:text-fg">
          Cancel
        </button>
      </div>
    </section>
  );
}
