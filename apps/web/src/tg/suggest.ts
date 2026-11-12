import { dayLabel } from "../lib/format";

/** Quick-add suggestions for the word being typed. Pure (no React) so it can be tested. */
export interface Suggestion {
  label: string;
  hint?: string;
  insert: string;
  /** Open the native date picker instead of inserting. */
  pickDate?: boolean;
}

const PRIORITIES: [string, string][] = [["!p1", "Urgent"], ["!p2", "High"], ["!p3", "Medium"], ["!p4", "Low"]];
const REPEATS = ["every day", "every weekday", "every week", "every month"];

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Suggestions for the word ending at the cursor (pure, so it's easy to test). */
export function suggestFor(word: string, ctx: { today: string; projects: { slug: string; title: string }[]; tags: string[] }): Suggestion[] {
  const w = word.toLowerCase();
  if (w.startsWith("@")) {
    const q = w.slice(1);
    const days: Suggestion[] = [
      { label: "Today", hint: short(ctx.today), insert: "@today" },
      { label: "Tomorrow", hint: short(addDaysIso(ctx.today, 1)), insert: "@tomorrow" },
      { label: "In 2 days", hint: dayLabel(addDaysIso(ctx.today, 2), ctx.today), insert: "@+2d" },
      { label: "In 3 days", hint: dayLabel(addDaysIso(ctx.today, 3), ctx.today), insert: "@+3d" },
      { label: "Next week", hint: dayLabel(addDaysIso(ctx.today, 7), ctx.today), insert: "@+7d" },
      { label: "Pick a date…", insert: "", pickDate: true },
    ];
    return q ? days.filter((d) => d.insert.slice(1).startsWith(q) || d.label.toLowerCase().startsWith(q) || (d.pickDate && "pick".startsWith(q))) : days;
  }
  if (w.startsWith("!")) {
    const q = w.slice(1).replace(/^p/, "");
    return PRIORITIES.filter(([k]) => !q || k.slice(2).startsWith(q)).map(([k, l]) => ({ label: l, hint: k, insert: k }));
  }
  if (w.startsWith("#")) {
    const q = w.slice(1).replace(/^project\/?/, "");
    const asProject = w.startsWith("#project/") || w === "#p" || w === "#pr" || "#project".startsWith(w);
    const projects = ctx.projects
      .filter((p) => !q || p.slug.includes(q) || p.title.toLowerCase().includes(q))
      .map((p) => ({ label: p.title, hint: "project", insert: `#project/${p.slug}` }));
    const tags = asProject && w.startsWith("#project/") ? [] : ctx.tags.filter((t) => !q || t.toLowerCase().startsWith(q)).map((t) => ({ label: `#${t}`, hint: "tag", insert: `#${t}` }));
    const slug = q.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    const fresh = slug && !ctx.projects.some((p) => p.slug === slug) ? [{ label: `New project “${slug}”`, hint: "create", insert: `#project/${slug}` }] : [];
    return [...projects, ...tags, ...fresh].slice(0, 12);
  }
  const time = w.match(/^(\d{1,2})(?::(\d{0,2}))?$/);
  if (time) {
    const h = Number(time[1]);
    if (h > 23) return [];
    const hh = String(h).padStart(2, "0");
    const mins = time[2] ? ["00", "15", "30", "45"].filter((m) => m.startsWith(time[2]!)) : ["00", "30"];
    const hours = time[2] !== undefined || h >= 10 || h === 0 ? [hh] : [hh, String(h + 12).padStart(2, "0")];
    return hours.flatMap((x) => mins.map((m) => ({ label: `${x}:${m}`, hint: "time", insert: `${x}:${m}` })));
  }
  if (w.length >= 2 && ("every".startsWith(w) || w.startsWith("every") || w.startsWith("🔁"))) {
    const q = "every".startsWith(w) ? "" : w.replace(/^🔁/, "").replace(/^every\s*/, "");
    return REPEATS.filter((r) => !q || r.slice(6).startsWith(q)).map((r) => ({ label: `Repeat ${r}`, hint: "🔁", insert: `🔁 ${r}` }));
  }
  return [];
}

