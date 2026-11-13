import { MessageSquare } from "lucide-react";
import { useAppNavigate } from "../app/platform";
import { api, refreshAll } from "../lib/api";
import { nagLine, progressOf } from "../lib/nag";
import type { TaskCard } from "../lib/types";
import { Chip, PriorityChip, ProgressBar, RepeatIcon, TaskCheck } from "./ui";

/** Open a task's page (the same task screen on web and in Telegram). */
export function useOpenTask() {
  const navigate = useAppNavigate();
  return { open: (id: string) => navigate(`/task/${id}`) };
}

export async function toggleDone(t: TaskCard) {
  await api.action(t.id, t.status === "done" ? "reopen" : "done");
  await refreshAll();
}

/** A task in a list. `variant="card"` is the bordered "needs attention" style. */
export function TaskRow({ t, variant = "row", showProject = true }: { t: TaskCard; variant?: "row" | "card"; showProject?: boolean }) {
  const { open } = useOpenTask();
  const nag = nagLine(t);
  const pct = progressOf(t);
  const done = t.status === "done";
  const card = variant === "card";
  return (
    <div
      className={`group flex items-center gap-3 ${card ? "rounded-[10px] border border-warn-line bg-card px-3.5 py-3" : "rounded-lg px-3.5 py-2.5 hover:bg-[var(--tg-chip)]"}`}
    >
      <TaskCheck t={t} onToggle={() => void toggleDone(t)} />
      <button type="button" onClick={() => open(t.id)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${done ? "text-faint line-through" : ""}`}>{t.title}</span>
          <PriorityChip p={t.priority} />
          {t.status === "blocked" && <Chip tone="danger">Waiting</Chip>}
          {t.rolloverCount > 0 && !done && <Chip tone="warn">{`↻ ${t.rolloverCount}`}</Chip>}
          {t.recurrence && <RepeatIcon />}
        </span>
        {(card || nag || t.lastRemark) && !done && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {t.sub.total > 0 && (
              <span className="flex items-center gap-1.5">
                <ProgressBar pct={pct} />
                {`${t.sub.done}/${t.sub.total} subtasks`}
              </span>
            )}
            {t.sub.total === 0 && pct > 0 && <span className="text-accent-soft">{`${pct}%`}</span>}
            {t.status === "blocked" && t.lastRemark ? (
              <span className="flex items-center gap-1.5 text-fg-2">
                <MessageSquare size={12} className="text-muted" aria-hidden />
                <i>{`“${t.lastRemark.text}”`}</i>
              </span>
            ) : null}
            {showProject && t.projectTitle && <span>{t.projectTitle}</span>}
            {nag && <span className={nag.tone === "warn" ? "text-warn" : ""}>{nag.text}</span>}
          </span>
        )}
      </button>
      {!card && showProject && t.projectTitle && <span className="hidden w-32 truncate text-xs text-muted sm:block">{t.projectTitle}</span>}
      <span className={`w-12 text-right font-mono text-xs ${card ? (t.priority === 1 ? "text-danger" : "text-warn") : "text-fg-2"}`}>
        {done && t.completedAt ? new Date(t.completedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : (t.dueTime ?? "")}
      </span>
    </div>
  );
}
