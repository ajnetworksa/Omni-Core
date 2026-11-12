import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, refreshAll } from "../lib/api";
import { haptic, type TgWebApp } from "./telegram";
import { Card, Ring, TgRow } from "./screens";
import { AddSheet } from "./AddSheet";

/** One project: progress, open tasks (tap the box = done), done list, "Add to <project>". */
export function TgProject({ tg }: { tg: TgWebApp | null }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug!), enabled: !!slug });
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const p = q.data;
  const back = useCallback(() => navigate("/tg/projects"), [navigate]);
  const add = useCallback(() => setAdding(true), []);

  useEffect(() => {
    if (!tg || adding) return;
    tg.BackButton.show();
    tg.BackButton.onClick(back);
    tg.MainButton.setText(p ? `Add to ${p.title}` : "Add task").show().enable();
    tg.MainButton.onClick(add);
    return () => { tg.BackButton.offClick(back); tg.MainButton.offClick(add); };
  }, [tg, back, add, adding, p]);

  if (q.isError) return <p className="px-6 py-10 text-center" style={{ color: "var(--tg-hint)" }}>That project doesn't exist any more.</p>;
  if (!p) return <p className="px-6 py-10 text-center" style={{ color: "var(--tg-hint)" }}>Loading…</p>;
  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      {!tg && (
        <button type="button" onClick={back} className="inline-flex items-center gap-1 self-start px-4 text-[15px]" style={{ color: "var(--tg-link)" }}>
          <ChevronLeft size={18} aria-hidden /> Projects
        </button>
      )}
      <div className="flex items-center gap-3.5 px-6">
        <Ring percent={p.percent} size={40} />
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 truncate font-display text-[26px] font-extrabold tracking-tight">{p.title}</h1>
          <span className="text-[14px]" style={{ color: "var(--tg-hint)" }}>
            {[`${p.done} of ${p.total} done`, p.overdue ? `${p.overdue} overdue` : "", p.blocked ? `${p.blocked} blocked` : ""].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      {p.openTasks.length > 0 ? (
        <section className="flex flex-col gap-2 px-4" aria-label="Open">
          <h2 className="m-0 px-1.5 font-display text-[14.5px] font-bold" style={{ color: "var(--tg-fg-2)" }}>Open</h2>
          <Card>{p.openTasks.map((t) => <TgRow key={t.id} t={t} boxed inProject />)}</Card>
        </section>
      ) : (
        <div className="mx-4 flex flex-col items-center gap-1 rounded-[18px] px-6 py-8 text-center" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
          <span className="font-display text-[16px] font-bold">{p.total ? "All done here" : "No tasks yet"}</span>
          <span className="text-[14px]" style={{ color: "var(--tg-hint)" }}>{p.total ? "Nice. Add the next thing when it comes up." : "Add the first one with the button below."}</span>
        </div>
      )}

      {p.doneTasks.length > 0 && (
        <section className="flex flex-col gap-1 px-4" aria-label="Done">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="self-start px-1.5 font-display text-[14.5px] font-bold" style={{ color: "var(--tg-hint)" }}>
            {showDone ? "Hide" : "Show"} {p.doneTasks.length} done
          </button>
          {showDone && <div className="flex flex-col">{p.doneTasks.map((t) => <TgRow key={t.id} t={t} inProject />)}</div>}
        </section>
      )}

      {!tg && !adding && (
        <div className="fixed inset-x-0 bottom-0 p-4" style={{ background: "linear-gradient(to top, var(--tg-bg) 70%, transparent)" }}>
          <button type="button" onClick={add} className="h-[52px] w-full rounded-[14px] text-[16px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>{`Add to ${p.title}`}</button>
        </div>
      )}
      {adding && <AddSheet tg={tg} project={{ slug: p.slug, title: p.title }} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** "New project" sheet: a name, then straight into the new project. */
export function NewProjectSheet({ tg, onClose }: { tg: TgWebApp | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = useCallback(async () => {
    if (!name.trim()) return;
    tg?.MainButton.showProgress();
    try {
      const p = await api.createProject(name.trim());
      haptic.ok();
      await refreshAll();
      onClose();
      navigate(`/tg/project/${encodeURIComponent(p.slug)}`);
    } catch {
      haptic.err();
      setError("Couldn't create it. Try a different name.");
    } finally {
      tg?.MainButton.hideProgress();
    }
  }, [name, tg, onClose, navigate]);
  useEffect(() => {
    if (!tg) return;
    tg.MainButton.setText("Create project").show();
    if (name.trim()) tg.MainButton.enable(); else tg.MainButton.disable();
    tg.MainButton.onClick(submit);
    tg.BackButton.show();
    tg.BackButton.onClick(onClose);
    return () => { tg.MainButton.offClick(submit); tg.BackButton.offClick(onClose); tg.BackButton.hide(); };
  }, [tg, submit, onClose, name]);
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end" style={{ background: "rgba(20,20,24,.35)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="New project" className="anim-in flex flex-col gap-3 rounded-t-[24px] px-5 pb-5 pt-3" style={{ background: "var(--tg-section)", boxShadow: "0 -8px 30px rgba(0,0,0,.12)" }}>
        <div className="mx-auto h-1 w-10 rounded-full" style={{ background: "var(--tg-check)" }} aria-hidden />
        <h2 className="m-0 font-display text-[19px] font-extrabold tracking-tight">New project</h2>
        <label htmlFor="tg-proj" className="sr-only">Project name</label>
        <input id="tg-proj" ref={ref} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="e.g. Home lab" className="rounded-[14px] px-3.5 py-3 text-[16.5px] outline-none" style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)" }} />
        <span className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>Creates <code>projects/{name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "name"}.md</code> in your notes.</span>
        {error && <p className="m-0 text-[13px]" style={{ color: "var(--tg-danger)" }}>{error}</p>}
        {!tg && (
          <button type="button" disabled={!name.trim()} onClick={() => void submit()} className="h-[52px] rounded-[14px] text-[16px] font-semibold disabled:opacity-50" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>Create project</button>
        )}
      </div>
    </div>
  );
}
