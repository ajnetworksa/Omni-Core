import { useAppNavigate as useNavigate } from "../app/platform";
import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { CheckSquare, FileText, Search, Sparkles } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { aiErrorText, api } from "../lib/api";
import type { AskResult, AskSource } from "../lib/types";
import { useOpenTask } from "./TaskRow";

const PAGES = [
  ["Today", "/"], ["Upcoming", "/upcoming"], ["Projects", "/projects"], ["Notes", "/notes"], ["Board", "/board"], ["Map", "/map"], ["Settings", "/settings"], ["Help", "/help"],
] as const;

type Item = { key: string; label: string; sub: string; run: () => void; icon: "task" | "note" | "page"; group?: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onClose, initialMode = "search", inline = false }: { open: boolean; onClose: () => void; initialMode?: "search" | "ask"; inline?: boolean }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"search" | "ask">(initialMode);
  const navigate = useNavigate();
  const { open: openTask } = useOpenTask();
  const input = useRef<HTMLInputElement>(null);
  const ai = useQuery({ queryKey: ["ai"], queryFn: api.ai, staleTime: 60_000, refetchInterval: 120_000 });
  const canAsk = !!ai.data?.features.ask;
  const results = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: open && mode === "search" && q.trim().length >= 2 });
  const dq = useDebounced(q.trim(), 350);
  const related = useQuery({
    queryKey: ["related", dq],
    queryFn: () => api.related(dq),
    enabled: open && mode === "search" && canAsk && dq.length >= 4,
    staleTime: 60_000,
    refetchInterval: false,
  });
  const asking = useMutation({ mutationFn: api.ask });

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setMode(initialMode);
      asking.reset();
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSource = (s: AskSource) => {
    if (s.kind === "task" && s.taskId) openTask(s.taskId);
    else if (s.noteId) navigate(`/notes/${s.noteId}`);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    if (mode === "ask") return [];
    const pages = PAGES.filter(([l]) => l.toLowerCase().includes(q.toLowerCase())).map(([label, to]): Item => ({ key: `p${to}`, label: `Go to ${label}`, sub: "", run: () => navigate(to), icon: "page" }));
    const tasks = (results.data?.tasks ?? []).map((t): Item => ({ key: t.id, label: t.title, sub: t.projectTitle ?? t.notePath ?? "", run: () => openTask(t.id), icon: "task" }));
    const notes = (results.data?.notes ?? []).map((n): Item => ({ key: n.id, label: n.title, sub: n.snippet || n.path, run: () => navigate(`/notes/${n.id}`), icon: "note" }));
    const seen = new Set([...tasks, ...notes].map((i) => i.key));
    const idOf = (h: AskSource) => (h.kind === "task" ? h.taskId : h.noteId) ?? "";
    const rel = (dq === q.trim() ? (related.data?.hits ?? []) : [])
      .filter((h) => {
        if (seen.has(idOf(h))) return false;
        seen.add(idOf(h));
        return true;
      })
      .slice(0, 5)
      .map((h, i): Item => ({
        key: `r${i}`,
        label: h.kind === "note" && h.heading ? `${h.title} › ${h.heading}` : h.title,
        sub: h.snippet,
        run: () => (h.kind === "task" && h.taskId ? openTask(h.taskId) : h.noteId && navigate(`/notes/${h.noteId}`)),
        icon: h.kind === "task" ? "task" : "note",
        group: "Related",
      }));
    return [...tasks, ...notes, ...rel, ...pages];
  }, [q, dq, mode, results.data, related.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const pick = (i: number) => {
    items[i]?.run();
    onClose();
  };
  const submitAsk = () => {
    if (q.trim().length >= 3 && !asking.isPending) asking.mutate(q.trim());
  };
  const switchMode = (m: "search" | "ask") => {
    setMode(m);
    setSel(0);
    asking.reset();
    input.current?.focus();
  };

  return (
    <div className={inline ? "px-4 pt-4" : "fixed inset-0 z-50 flex items-start justify-center bg-[var(--tg-overlay)] px-4 pt-[12vh]"} onMouseDown={(e) => !inline && e.target === e.currentTarget && onClose()}>
      <div role={inline ? "search" : "dialog"} aria-modal={inline ? undefined : true} aria-label="Search and ask" className={`anim-in w-full overflow-hidden rounded-[18px] bg-panel ${inline ? "" : "max-w-xl shadow-2xl"}`} style={{ boxShadow: "var(--tg-ring)" }}>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          {mode === "ask" ? <Sparkles size={16} className="text-accent" aria-hidden /> : <Search size={16} className="text-muted" aria-hidden />}
          <label htmlFor="palette" className="sr-only">{mode === "ask" ? "Ask a question about your notes" : "Search tasks, notes and pages"}</label>
          <input
            id="palette"
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Tab" && canAsk) {
                e.preventDefault();
                switchMode(mode === "ask" ? "search" : "ask");
                return;
              }
              if (mode === "ask") {
                if (e.key === "Enter") submitAsk();
                return;
              }
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") pick(sel);
            }}
            placeholder={mode === "ask" ? "Ask your notes… e.g. why did we replace the core switch?" : "Search tasks and notes, or jump to a page…"}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          {canAsk && (
            <div className="flex flex-none rounded-md border border-line p-0.5 text-xs" role="tablist" aria-label="Mode">
              {(["search", "ask"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={`rounded px-2 py-0.5 capitalize ${mode === m ? "bg-[var(--tg-chip)] text-fg" : "text-muted hover:text-fg"}`}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === "ask" ? (
          <AskPanel q={q} state={asking} onSubmit={submitAsk} onOpen={openSource} />
        ) : (
          <ul id="palette-list" role="listbox" className="m-0 max-h-[50vh] list-none overflow-y-auto p-1.5">
            {items.map((it, i) => (
              <Fragment key={it.key}>
                {it.group && items[i - 1]?.group !== it.group && (
                  <li role="presentation" className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                    <Sparkles size={11} aria-hidden /> {it.group}
                  </li>
                )}
                <li role="option" aria-selected={i === sel}>
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => pick(i)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? "bg-[var(--tg-chip)]" : ""}`}>
                    {it.icon === "note" ? (
                      <FileText size={15} className="flex-none text-muted" aria-hidden />
                    ) : it.icon === "task" && it.group ? (
                      <CheckSquare size={15} className="flex-none text-muted" aria-hidden />
                    ) : (
                      <span className="h-3.5 w-3.5 flex-none rounded-full border-2 border-[var(--tg-check)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{it.label}</span>
                      {it.sub && <span className="block truncate text-xs text-muted">{it.sub}</span>}
                    </span>
                  </button>
                </li>
              </Fragment>
            ))}
            {q.trim().length >= 2 && results.isSuccess && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing found.</li>}
          </ul>
        )}
        {canAsk && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-faint">
            <span>
              <kbd className="rounded border border-line px-1 font-sans">Tab</kbd> {mode === "ask" ? "back to search" : "ask your notes"}
            </span>
            <span>{ai.data?.cloud?.mode === "prefer" ? `${ai.data.cloud.model} · cloud` : ai.data?.local ? `${ai.data.local.chatModel} · local` : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const CLOUD = new Set(["anthropic", "openai", "gemini"]);

function AskPanel({ q, state, onSubmit, onOpen }: { q: string; state: UseMutationResult<AskResult, Error, string>; onSubmit: () => void; onOpen: (s: AskSource) => void }) {
  if (state.isPending) {
    return (
      <div className="flex items-center gap-2.5 px-5 py-6 text-sm text-muted" role="status">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Reading your notes…
      </div>
    );
  }
  if (state.isError) {
    return (
      <p className="m-0 px-5 py-6 text-sm text-warn" role="alert">
        {aiErrorText(state.error)}
      </p>
    );
  }
  const r = state.data;
  if (!r) {
    return (
      <div className="px-5 py-5 text-sm text-muted">
        <p className="m-0">Answers come only from your notes and tasks, with links to the sources.</p>
        <p className="m-0 mt-2 text-xs text-faint">Try “what's blocking the VLAN migration?” or “switch tasks from last quarter”.</p>
        {q.trim().length >= 3 && (
          <button type="button" onClick={onSubmit} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
            Ask ↵
          </button>
        )}
      </div>
    );
  }
  const byN = new Map(r.sources.map((s) => [s.n, s]));
  // The answer is shown as text; [n] markers become links to the source. Never rendered as HTML.
  const parts = r.answer.split(/(\[\d{1,2}\])/g);
  const shown = r.sources.filter((s) => r.cited.includes(s.n));
  const list = shown.length ? shown : r.sources.slice(0, 3);
  return (
    <div className="max-h-[56vh] overflow-y-auto px-5 py-4" aria-live="polite">
      <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-fg">
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d{1,2})\]$/);
          const s = m ? byN.get(Number(m[1])) : undefined;
          return s ? (
            <button key={i} type="button" onClick={() => onOpen(s)} title={s.title} aria-label={`Source ${s.n}: ${s.title}`} className="mx-0.5 rounded bg-[var(--tg-chip)] px-1 align-[1px] font-mono text-[11px] text-accent hover:bg-[var(--tg-check)]">
              {s.n}
            </button>
          ) : (
            <Fragment key={i}>{p}</Fragment>
          );
        })}
      </p>
      {list.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Sources{r.timeRange ? ` · ${r.timeRange}` : ""}</div>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {list.map((s) => (
              <li key={s.n}>
                <button type="button" onClick={() => onOpen(s)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--tg-chip)]">
                  <span className="mt-0.5 w-3 flex-none font-mono text-[11px] text-accent">{s.n}</span>
                  {s.kind === "task" ? <CheckSquare size={14} className="mt-0.5 flex-none text-muted" aria-hidden /> : <FileText size={14} className="mt-0.5 flex-none text-muted" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {s.title}
                      {s.heading ? <span className="text-muted"> › {s.heading}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">{s.snippet}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.provider !== "none" && <div className="mt-3 text-[11px] text-faint">Answered by {r.model} · {CLOUD.has(r.provider) ? "cloud" : "local"}</div>}
    </div>
  );
}
