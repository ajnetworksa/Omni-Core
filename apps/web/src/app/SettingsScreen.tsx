import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Database, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, refreshAll } from "../lib/api";
import type { SettingItem, SettingsPage } from "../lib/types";
import { haptic } from "../tg/telegram";
import { useBack, useTo } from "./platform";
import { Button, Card, Explain, hint, PageTitle, useToast } from "./ui";
import { howRemindersWork } from "./words";

const DAYS: [string, string][] = [["sat", "Sat"], ["sun", "Sun"], ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"]];
const MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360];
const field = "h-10 rounded-[10px] px-2.5 text-[15px] outline-none";
const fieldStyle = { background: "var(--tg-secondary)", color: "var(--tg-fg)" };

export function SettingsScreen() {
  const navigate = useNavigate();
  const to = useTo();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system });
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: api.prefs });
  const [restarting, setRestarting] = useState(false);
  useBack(() => navigate(to("/more")));

  const save = async (key: string, value: string | null) => {
    try {
      const r = await api.saveSettings({ [key]: value });
      qc.setQueryData<SettingsPage>(["settings"], (old) => (old ? { ...old, groups: r.groups } : old));
      await qc.invalidateQueries({ queryKey: ["prefs"] });
      haptic.ok();
      toast.show({ text: r.restart.length ? "Saved. Tap “Apply now” at the top to use it." : value === null ? "Back to the default" : "Saved" });
    } catch (e) {
      haptic.err();
      const msg = e instanceof ApiError && typeof e.body === "object" && e.body && "message" in e.body ? String((e.body as { message: string }).message) : "Couldn't save that.";
      toast.show({ text: msg });
    }
  };

  if (!q.data) return <p className="px-6 py-10 text-center" style={hint}>Loading…</p>;
  const all = q.data.groups.flatMap((g) => g.items);
  const v = (k: string) => all.find((i) => i.key === k)?.value ?? "";
  const pending = all.filter((i) => i.pending);

  const applyNow = async () => {
    setRestarting(true);
    try {
      await api.restart();
      // Wait for the app to come back, then reload everything.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const s = await api.settings();
          if (!s.groups.flatMap((g) => g.items).some((x) => x.pending)) break;
        } catch {
          /* still restarting */
        }
      }
      await refreshAll();
      await qc.invalidateQueries();
      toast.show({ text: "Applied" });
    } catch (e) {
      toast.show({ text: e instanceof ApiError && e.status === 409 ? "Restart the app yourself to apply these (it isn't running in Docker)." : "Couldn't restart. Try again." });
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-24 pt-2">
      <PageTitle icon={<SettingsIcon size={26} style={{ color: "var(--tg-accent)" }} aria-hidden />} title="Settings" sub="Changes save as you make them." />

      {pending.length > 0 && (
        <div className="mx-4 flex flex-col gap-2 rounded-[16px] px-4 py-3.5" style={{ background: "var(--tg-note-bg)", boxShadow: "0 0 0 1px var(--tg-note-line)", color: "var(--tg-note-fg)" }}>
          <span className="text-[14.5px]"><b>{pending.map((p) => p.label.replace(/:.*/, "")).join(", ")}</b> {pending.length > 1 ? "take" : "takes"} effect after a quick restart (about 5 seconds; nothing is lost).</span>
          {q.data.canRestart ? (
            <Button tone="accent" disabled={restarting} onClick={() => void applyNow()}>{restarting ? <><RefreshCw size={16} className="animate-spin" aria-hidden />Restarting…</> : "Apply now"}</Button>
          ) : (
            <span className="text-[13.5px]">Restart the app to apply them.</span>
          )}
        </div>
      )}

      {q.data.groups.map((g) => (
        <section key={g.id} aria-label={g.title} className="flex flex-col gap-2 px-4">
          <h2 className="m-0 px-1.5 font-display text-[15px] font-bold" style={{ color: "var(--tg-fg-2)" }}>{g.title}</h2>
          {g.id === "reminders" && <PauseCard pausedUntil={prefs.data?.pausedUntil ?? null} />}
          <Card>
            {g.items.map((item) => (
              <Row key={item.key} item={item} onSave={save} timezones={q.data.timezones} />
            ))}
          </Card>
          {g.id === "reminders" && (
            <details className="rounded-[14px] px-4 py-3 text-[14px]" style={{ background: "var(--tg-secondary)" }}>
              <summary className="cursor-pointer font-semibold">How reminders work</summary>
              <ol className="mb-0 mt-2 flex flex-col gap-1.5 pl-5 leading-snug" style={{ color: "var(--tg-fg-2)" }}>
                {howRemindersWork({ overdue: v("everyOverdue"), partial: v("everyPartial"), update: v("everyUpdate"), quiet: v("quietHours"), defaultTime: v("defaultTime") }).map((l) => <li key={l}>{l}</li>)}
              </ol>
            </details>
          )}
        </section>
      ))}

      <SystemSection />
    </div>
  );
}

function Row({ item, onSave, timezones }: { item: SettingItem; onSave: (k: string, v: string | null) => void; timezones: string[] }) {
  const [text, setText] = useState(item.value);
  useEffect(() => setText(item.value), [item.value]);
  const id = `set-${item.key}`;
  let control: React.ReactNode = null;
  switch (item.type) {
    case "text":
      control = <input id={id} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== item.value && onSave(item.key, text)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="Your name" className={`${field} w-full`} style={fieldStyle} />;
      break;
    case "time":
      control = <input id={id} type="time" value={item.value} onChange={(e) => e.target.value && onSave(item.key, e.target.value)} className={field} style={fieldStyle} />;
      break;
    case "optional-time": {
      const on = item.value !== "";
      control = (
        <div className="flex items-center gap-2">
          <Toggle label={item.label} on={on} onChange={(x) => onSave(item.key, x ? "08:00" : "")} />
          {on && <input id={id} type="time" value={item.value} onChange={(e) => e.target.value && onSave(item.key, e.target.value)} className={field} style={fieldStyle} aria-label={`${item.label} time`} />}
        </div>
      );
      break;
    }
    case "timezone":
      control = (
        <select id={id} value={item.value} onChange={(e) => onSave(item.key, e.target.value)} className={`${field} w-full`} style={fieldStyle}>
          {timezones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </select>
      );
      break;
    case "select":
      control = (
        <div role="radiogroup" aria-label={item.label} className="flex flex-wrap gap-1.5">
          {item.options!.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={item.value === o.value} onClick={() => item.value !== o.value && onSave(item.key, o.value)} className="h-10 rounded-[10px] px-3 text-[14px] font-medium" style={item.value === o.value ? { background: "var(--tg-accent)", color: "var(--tg-accent-fg)" } : { background: "var(--tg-chip)" }}>
              {item.key === "accent" && <span className="mr-1.5 inline-block h-3 w-3 rounded-full align-[-1px]" style={{ background: { blue: "#2f6feb", teal: "#0f766e", violet: "#7c3aed", pink: "#db2777" }[o.value] }} aria-hidden />}
              {o.label}
            </button>
          ))}
        </div>
      );
      break;
    case "minutes": {
      const opts = [...new Set([...MINUTES, Number(item.value)])].sort((a, b) => a - b);
      control = (
        <select id={id} value={item.value} onChange={(e) => onSave(item.key, e.target.value)} className={field} style={fieldStyle}>
          {opts.map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>)}
        </select>
      );
      break;
    }
    case "quiet-hours": {
      const on = item.value !== "";
      const [a, b] = on ? item.value.split("-") : ["23:00", "07:00"];
      control = (
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label={item.label} on={on} onChange={(x) => onSave(item.key, x ? "23:00-07:00" : "")} />
          {on && (
            <>
              <input type="time" aria-label="Quiet from" value={a} onChange={(e) => e.target.value && onSave(item.key, `${e.target.value}-${b}`)} className={field} style={fieldStyle} />
              <span style={hint}>to</span>
              <input type="time" aria-label="Quiet until" value={b} onChange={(e) => e.target.value && onSave(item.key, `${a}-${e.target.value}`)} className={field} style={fieldStyle} />
            </>
          )}
        </div>
      );
      break;
    }
    case "weekdays": {
      const set = new Set(item.value.split(",").filter(Boolean));
      control = (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={item.label}>
          {DAYS.map(([d, l]) => {
            const on = set.has(d);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => { const n = new Set(set); if (on) n.delete(d); else n.add(d); onSave(item.key, [...n].join(",")); }} className="h-10 w-12 rounded-[10px] text-[14px] font-medium" style={on ? { background: "var(--tg-accent)", color: "var(--tg-accent-fg)" } : { background: "var(--tg-chip)" }}>
                {l}
              </button>
            );
          })}
        </div>
      );
      break;
    }
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="flex flex-col gap-0.5">
          <span className="text-[15.5px] font-semibold">{item.label}</span>
          <span className="text-[13.5px] leading-snug" style={hint}>{item.help}</span>
        </label>
        {item.source === "app" && (
          <button type="button" className="flex-none text-[13px]" style={{ color: "var(--tg-link)" }} onClick={() => onSave(item.key, null)} title="Use the value from .env (or the default)">Reset</button>
        )}
      </div>
      {control}
      {item.pending && <span className="text-[12.5px]" style={{ color: "var(--tg-warn)" }}>Waiting for a restart to take effect</span>}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${label}: ${on ? "on" : "off"}`} onClick={() => onChange(!on)} className="relative h-7 w-12 flex-none rounded-full transition-colors" style={{ background: on ? "var(--tg-accent)" : "var(--tg-check)" }}>
      <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: on ? 22 : 2 }} />
    </button>
  );
}

function PauseCard({ pausedUntil }: { pausedUntil: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const pause = async (minutes: number, msg: string) => {
    await api.pause(minutes);
    await qc.invalidateQueries({ queryKey: ["prefs"] });
    toast.show({ text: msg });
  };
  const untilMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return Math.round((d.getTime() - Date.now()) / 60_000);
  };
  return (
    <div className="flex flex-col gap-2 rounded-[18px] px-4 py-3.5" style={pausedUntil ? { background: "var(--tg-note-bg)", boxShadow: "0 0 0 1px var(--tg-note-line)" } : { background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
      <span className="flex items-center gap-2 text-[15.5px] font-semibold">
        {pausedUntil ? `🔕 Paused until ${new Date(pausedUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "Pause all reminders"}
        <Explain text="Stops every reminder for a while (a meeting, a day off, a holiday). Tasks stay on your lists; reminders start again by themselves." />
      </span>
      <div className="flex flex-wrap gap-1.5">
        {pausedUntil ? (
          <Button tone="accent" onClick={() => void pause(0, "Reminders are back on")}>Resume now</Button>
        ) : (
          <>
            <Button onClick={() => void pause(60, "Paused for an hour")}>1 hour</Button>
            <Button onClick={() => void pause(untilMorning(), "Paused until tomorrow morning")}>Until tomorrow</Button>
            <Button onClick={() => void pause(7 * 24 * 60, "Paused for a week")}>A week</Button>
          </>
        )}
      </div>
    </div>
  );
}

function SystemSection() {
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system });
  const qc = useQueryClient();
  const toast = useToast();
  const s = sys.data;
  if (!s) return null;
  const v = s.version;
  const update = v.updateAvailable && v.latest ? v.latest : null;
  const cmd = "cd ~/app && scripts/update.sh";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.show({ text: "Copied" });
    } catch {
      toast.show({ text: cmd });
    }
  };
  const dot = (ok: boolean) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: ok ? "var(--tg-ok)" : "var(--tg-check)" }} aria-hidden />;
  return (
    <section aria-label="System" className="flex flex-col gap-2 px-4">
      <h2 className="m-0 px-1.5 font-display text-[15px] font-bold" style={{ color: "var(--tg-fg-2)" }}>App & updates</h2>
      <Card>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="text-[15.5px] font-semibold">Version {v.version}{v.sha ? <span className="font-normal" style={hint}>{` · ${v.sha.slice(0, 7)}`}</span> : null}</span>
          {update ? (
            <>
              <span className="text-[14px]" style={{ color: "var(--tg-warn)" }}>Version {update.version} is available.</span>
              <span className="text-[13.5px]" style={hint}>To update, run this on your server. It backs up first and rolls back by itself if something goes wrong:</span>
            </>
          ) : (
            <span className="text-[13.5px]" style={hint}>To update when there's a new version, run this on your server. It backs up first and rolls back by itself if something goes wrong:</span>
          )}
          <button type="button" onClick={() => void copy()} className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left font-mono text-[13px]" style={{ background: "var(--tg-secondary)" }}>
            {cmd}<Copy size={14} aria-label="Copy" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 px-4 py-3.5 text-[14.5px]">
          <span className="flex items-center gap-2">{dot(s.telegram.status === "running")}Telegram bot: {s.telegram.status === "running" ? "connected" : s.telegram.status === "disabled" ? "not set up (TELEGRAM_BOT_TOKEN in .env)" : s.telegram.status}</span>
          <span className="flex items-center gap-2">{dot(s.telegram.miniApp)}Telegram Mini App: {s.telegram.miniApp ? "on" : "off (needs PUBLIC_URL or the quick tunnel)"}</span>
          <span className="flex items-center gap-2">{dot(!!s.ai.ask)}AI: {s.ai.ask ? `on (${s.ai.model})` : "off"}</span>
          <span className="pt-1 text-[13.5px]" style={hint}>{`${s.counts.tasks} open tasks · ${s.counts.done} done · ${s.counts.projects} projects · ${s.counts.notes} notes`}</span>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="flex items-center gap-2 text-[15.5px] font-semibold"><Database size={16} aria-hidden />Backups</span>
          <span className="text-[13.5px] leading-snug" style={hint}>
            The app's database is backed up before every update. Your notes are plain files in the vault folder; copy that folder somewhere safe too.
            {s.backups[0] ? ` Latest: ${new Date(s.backups[0].at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : " No backups yet."}
          </span>
          <Button onClick={async () => { const b = await api.backupNow(); await qc.invalidateQueries({ queryKey: ["system"] }); toast.show({ text: `Backed up (${Math.round(b.bytes / 1024)} KB)` }); }}>Back up now</Button>
        </div>
      </Card>
    </section>
  );
}
