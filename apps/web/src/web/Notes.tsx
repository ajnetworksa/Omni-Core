import { useAppNavigate as useNavigate, AppLink as Link, useBack, usePlatform } from "../app/platform";
import { Confirm, useToast } from "../app/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FilePlus, FileText, Pencil, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { api, ApiError, refreshAll } from "../lib/api";
import { Markdown } from "../lib/markdown";
import type { NoteDetail, NoteListItem } from "../lib/types";
import { toggleDone, useOpenTask } from "./TaskRow";
import { Empty } from "./ui";

export function Notes() {
  const { id } = useParams();
  const list = useQuery({ queryKey: ["notes"], queryFn: api.notes });
  const { wide } = usePlatform();
  const navigate = useNavigate();
  // On a phone / in Telegram: the list, or one note (with Back), not both.
  useBack(!wide && id ? () => navigate("/notes") : null);
  return (
    <div className="flex h-full flex-col md:flex-row">
      {(wide || !id) && <NoteTree notes={list.data ?? []} activeId={id} />}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {id ? <NoteView id={id} notes={list.data ?? []} /> : wide ? <div className="p-10"><Empty>Pick a note on the left, or create one.</Empty></div> : null}
      </div>
    </div>
  );
}

function NoteTree({ notes, activeId }: { notes: NoteListItem[]; activeId?: string }) {
  const navigate = useNavigate();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const m = new Map<string, NoteListItem[]>();
    for (const n of notes) {
      const dir = n.path.includes("/") ? n.path.split("/")[0]! : "";
      m.set(dir, [...(m.get(dir) ?? []), n]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [notes]);
  const [draft, setDraft] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft?.trim()) return setDraft(null);
    const n = await api.createNote(draft.trim());
    setDraft(null);
    await refreshAll();
    if ("id" in n) navigate(`/notes/${n.id}`);
  };
  return (
    <nav aria-label="Notes" className="flex flex-col gap-0.5 border-line bg-panel p-3 text-[13.5px] md:w-64 md:flex-none md:border-r md:overflow-y-auto">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-xs font-semibold uppercase tracking-[.06em] text-muted">{`Vault · ${notes.length}`}</span>
        <button type="button" onClick={() => setDraft("")} aria-label="New note" className="rounded p-1 text-muted hover:bg-[var(--tg-chip)] hover:text-fg"><FilePlus size={16} /></button>
      </div>
      {draft !== null && (
        <form onSubmit={(e) => void create(e)} className="px-1 pb-2">
          <label htmlFor="new-note" className="sr-only">New note title</label>
          <input id="new-note" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => !draft.trim() && setDraft(null)} onKeyDown={(e) => e.key === "Escape" && setDraft(null)} placeholder="Note title, then Enter" className="w-full rounded-md border border-accent/50 bg-card px-2.5 py-1.5 text-[13px] text-fg outline-none" />
        </form>
      )}
      {groups.map(([dir, items]) => (
        <div key={dir || "root"}>
          {dir && (
            <button type="button" onClick={() => setClosed((s) => { const n = new Set(s); n.has(dir) ? n.delete(dir) : n.add(dir); return n; })} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-fg-2 hover:bg-[var(--tg-chip)]" aria-expanded={!closed.has(dir)}>
              {closed.has(dir) ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}{dir}
            </button>
          )}
          {!closed.has(dir) &&
            [...items].sort((a, b) => (dir === "daily" ? b.path.localeCompare(a.path) : a.title.localeCompare(b.title))).map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`} aria-current={n.id === activeId ? "page" : undefined} className={`flex items-center gap-2 rounded py-1 pr-2 ${dir ? "pl-7" : "pl-2"} ${n.id === activeId ? "bg-[var(--tg-chip)] text-fg" : "text-fg-2 hover:bg-[var(--tg-chip)]"}`}>
                {!dir && <FileText size={13} className="text-muted" aria-hidden />}
                <span className="truncate">{n.title}</span>
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );
}

function NoteView({ id, notes }: { id: string; notes: NoteListItem[] }) {
  const q = useQuery({ queryKey: ["note", id], queryFn: () => api.note(id) });
  const { open } = useOpenTask();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const byTitle = useMemo(() => new Map(notes.map((n) => [n.title.toLowerCase(), n.id])), [notes]);
  const n = q.data;
  if (!n) return <div className="p-10 text-muted">{q.isError ? "Note not found." : "Loading…"}</div>;

  const save = async (note: NoteDetail) => {
    try {
      await api.saveNote(note.id, editing!, note.checksum);
      setEditing(null);
      setError("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "This note changed on disk (maybe in Obsidian) since you opened it. Copy your text, reload, and re-apply." : "Couldn't save.");
    }
  };

  return (
    <div className="flex flex-col xl:flex-row">
      <article className="mx-auto w-full max-w-3xl px-6 py-7 sm:px-10">
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-xs text-faint">{n.path}</span>
          <span className="flex-1" />
          {editing === null ? (
            <>
              <button type="button" onClick={() => setEditing(n.content)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium" style={{ background: "var(--tg-chip)" }}><Pencil size={13} aria-hidden />Edit</button>
              <button type="button" onClick={() => setDeleting(true)} aria-label="Delete note" className="inline-flex items-center rounded-full p-2" style={{ background: "var(--tg-block-bg)", color: "var(--tg-danger)" }}><Trash2 size={14} /></button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { setEditing(null); setError(""); }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted hover:text-fg"><X size={13} aria-hidden />Cancel</button>
              <button type="button" onClick={() => void save(n)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-[var(--tg-accent-fg)]"><Save size={13} aria-hidden />Save</button>
            </>
          )}
        </div>
        {deleting && (
          <Confirm
            title="Delete this note?"
            text={<>“{n.title}” moves to the vault's trash folder (<code>.trash</code>), so Obsidian can still find it. Tasks in it leave your lists. You can undo for a few seconds.</>}
            confirm="Delete note"
            onClose={() => setDeleting(false)}
            onConfirm={async () => {
              setDeleting(false);
              const r = await api.deleteNote(n.id);
              await refreshAll();
              toast.show({ text: `Deleted: ${n.title}`, undo: () => api.undo(r.undo) });
              navigate("/notes");
            }}
          />
        )}
        {error && <p role="alert" className="mb-3 rounded-lg border border-[var(--tg-block-line)] bg-[var(--tg-block-bg)] px-3 py-2 text-sm text-danger">{error}</p>}
        {editing !== null ? (
          <>
            <label htmlFor="note-editor" className="sr-only">Note content</label>
            <textarea id="note-editor" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} className="min-h-[60vh] w-full resize-y rounded-lg border border-line-strong bg-card p-4 font-mono text-[13px] leading-relaxed text-fg outline-none focus:border-accent/60" />
          </>
        ) : (
          <Markdown
            source={n.content}
            h={{
              tasks: n.tasks,
              onToggle: (t) => void toggleDone(t),
              onOpenTask: (t) => open(t.id),
              resolveLink: (title) => byTitle.get(title.toLowerCase()) ?? null,
              onLink: (target) => navigate(`/notes/${target}`),
            }}
          />
        )}
      </article>
      <aside aria-label="Links" className="flex flex-col gap-4 border-line px-6 py-7 text-[13px] xl:w-64 xl:flex-none xl:border-l">
        <div>
          <h2 className="m-0 mb-2 text-xs font-semibold uppercase tracking-[.06em] text-muted">{`Backlinks · ${n.backlinks.length}`}</h2>
          {n.backlinks.length === 0 && <p className="m-0 text-faint">Nothing links here yet.</p>}
          {n.backlinks.map((b) => (
            <Link key={b.id} to={`/notes/${b.id}`} className="block rounded-md bg-card px-2.5 py-2 text-fg-2 hover:text-fg">{b.title}</Link>
          ))}
        </div>
        <div>
          <h2 className="m-0 mb-2 text-xs font-semibold uppercase tracking-[.06em] text-muted">{`Links · ${n.outgoing.length}`}</h2>
          {n.outgoing.map((o, i) =>
            o.targetId ? (
              <Link key={i} to={`/notes/${o.targetId}`} className="block py-1 text-accent-soft hover:underline">{o.title}{o.heading ? ` › ${o.heading}` : ""}</Link>
            ) : (
              <span key={i} className="block py-1 text-faint" title="Not created yet">{o.title}</span>
            ),
          )}
        </div>
        {n.tasks.length > 0 && <p className="m-0 text-faint">{`${n.tasks.filter((t) => t.status === "done").length} of ${n.tasks.length} tasks done in this note`}</p>}
      </aside>
    </div>
  );
}
