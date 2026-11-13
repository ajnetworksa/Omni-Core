import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryClient, refreshAll } from "../lib/api";
import { progressOf } from "../lib/nag";
import type { TaskCard, TaskStatus } from "../lib/types";
import { useOpenTask } from "./TaskRow";
import { Chip, PriorityChip, ProgressBar } from "./ui";

const COLUMNS: { id: Exclude<TaskStatus, "cancelled">; label: string; hint: string }[] = [
  { id: "backlog", label: "Someday", hint: "no plan yet, no reminders" },
  { id: "ready", label: "To do", hint: "ready to start" },
  { id: "in_progress", label: "Doing", hint: "started or partly done" },
  { id: "blocked", label: "Waiting", hint: "stuck on something" },
  { id: "done", label: "Done", hint: "last 7 days" },
];

export function Board() {
  const q = useQuery({ queryKey: ["board"], queryFn: api.board });
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = async (e: DragEndEvent) => {
    const to = e.over?.id as TaskStatus | undefined;
    const card = e.active.data.current as TaskCard | undefined;
    if (!to || !card || card.status === to) return;
    // Optimistic move, then persist (the server rewrites the checkbox in the markdown file).
    queryClient.setQueryData(["board"], (old: Record<string, TaskCard[]> | undefined) => {
      if (!old) return old;
      const next = Object.fromEntries(Object.entries(old).map(([k, v]) => [k, v.filter((x) => x.id !== card.id)]));
      next[to] = [{ ...card, status: to }, ...(next[to] ?? [])];
      return next;
    });
    try {
      await api.patch(card.id, { status: to });
      setError("");
    } catch {
      setError("Couldn't move that task — its line changed in the file.");
    }
    await refreshAll();
  };
  return (
    <div className="flex h-full flex-col gap-4 px-5 py-7 sm:px-9">
      <div className="flex items-end justify-between">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight">Board</h1>
        <p className="m-0 text-xs text-muted">Drag between columns: the checkbox in the note changes with it.</p>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(5,minmax(190px,1fr))] gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((c) => <Column key={c.id} col={c} cards={q.data?.[c.id] ?? []} />)}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ col, cards }: { col: (typeof COLUMNS)[number]; cards: TaskCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <section ref={setNodeRef} aria-label={col.label} className={`flex min-h-[300px] flex-col gap-2 rounded-xl border p-2.5 transition ${isOver ? "border-accent/60 bg-[var(--tg-accent-soft)]" : "border-line bg-panel"}`}>
      <div className="flex items-center justify-between px-1 pb-1">
        <h2 className="m-0 text-[13px] font-semibold">{col.label}</h2>
        <span className="text-xs text-faint">{cards.length}</span>
      </div>
      {cards.map((t) => <Card key={t.id} t={t} />)}
    </section>
  );
}

function Card({ t }: { t: TaskCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t });
  const { open } = useOpenTask();
  const pct = progressOf(t);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`cursor-grab rounded-lg border border-line-strong bg-card p-3 text-sm ${isDragging ? "z-10 opacity-90 shadow-xl" : ""}`}
    >
      <button type="button" onClick={() => open(t.id)} className="w-full text-left">
        <div className={`font-medium ${t.status === "done" ? "text-faint line-through" : ""}`}>{t.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <PriorityChip p={t.priority} />
          {t.dueDate && <Chip>{t.dueDate.slice(5)}</Chip>}
          {t.rolloverCount > 0 && <Chip tone="warn">{`↻ ${t.rolloverCount}`}</Chip>}
          {t.projectTitle && <span>{t.projectTitle}</span>}
        </div>
        {pct > 0 && t.status !== "done" && <div className="mt-2 flex items-center gap-2 text-xs text-muted"><ProgressBar pct={pct} w={80} />{`${pct}%`}</div>}
      </button>
    </div>
  );
}
