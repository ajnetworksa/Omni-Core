export function rel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - now;
  const m = Math.round(Math.abs(diff) / 60_000);
  const s = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.round(m / 1440)}d`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function lateBy(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m <= 0) return "";
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export function dayLabel(iso: string, today: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export const priorityLabel = (p: number) => (p < 4 ? `p${p}` : "");
