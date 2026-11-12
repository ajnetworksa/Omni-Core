/** Date helpers that are timezone-aware without pulling in a date library. */

/** YYYY-MM-DD for `date` as seen in `timeZone`. */
export function isoDateInTz(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayInTz(timeZone: string, now: Date = new Date()): string {
  return isoDateInTz(now, timeZone);
}

/** Adds whole days to a YYYY-MM-DD string (calendar arithmetic, tz-independent). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** HH:mm for `date` in `timeZone`. */
export function localTimeHHMM(timeZone: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(timeZone: string, date: Date = new Date()): number {
  const [h, m] = localTimeHHMM(timeZone, date).split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Offset (ms) of `timeZone` from UTC at instant `date`. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of local wall-clock `isoDate` + `hhmm` in `timeZone`. */
export function zonedToInstant(isoDate: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = isoDate.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(timeZone, new Date(guess));
  t = guess - tzOffsetMs(timeZone, new Date(t)); // second pass handles DST edges
  return new Date(t);
}

/** End of the local day (23:59:59.999) for `date` in `timeZone`, as a UTC instant. */
export function endOfLocalDay(timeZone: string, date: Date = new Date()): Date {
  const today = isoDateInTz(date, timeZone);
  return new Date(zonedToInstant(addDays(today, 1), "00:00", timeZone).getTime() - 1);
}
