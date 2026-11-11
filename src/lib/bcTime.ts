// British Columbia time, used for every date and time the app shows or
// treats as "today".
//
// BC stopped changing its clocks: after springing forward on 8 March 2026 it
// stayed there, on its year-round single time standard, Pacific Time (PCT) —
// UTC−7 all year. The app can't
// lean on the runtime's own time zone for that:
//   - on Vercel the server runs in UTC, so its "today" turns over at 5 p.m.;
//   - a browser, phone, or server whose time-zone data predates the change
//     still falls back to UTC−8 in November, an hour off.
// So the offset is applied here: UTC−7 from the change onward, and the usual
// America/Vancouver rules (identical in every tz database) before it.

// 2:00 a.m. PST on Sunday 8 March 2026, when clocks went forward for the last time.
const PERMANENT_FROM_MS = Date.UTC(2026, 2, 8, 10);
// IANA's "Etc/GMT+7" is UTC−7 (the sign is inverted by POSIX convention).
const PERMANENT_ZONE = "Etc/GMT+7";
const HISTORIC_ZONE = "America/Vancouver";

export function bcTimeZone(at: Date): string {
  return at.getTime() >= PERMANENT_FROM_MS ? PERMANENT_ZONE : HISTORIC_ZONE;
}

function bcParts(at: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: bcTimeZone(at), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Today's date in BC, yyyy-mm-dd.
export function bcTodayIso(now: Date = new Date()): string {
  const { year, month, day } = bcParts(now);
  return `${year}-${month}-${day}`;
}

// Today's year and month (1–12) in BC.
export function bcYearMonth(now: Date = new Date()): { year: number; month: number } {
  const { year, month } = bcParts(now);
  return { year: Number(year), month: Number(month) };
}

// A stored instant (ISO date-time) as BC clock time: "Nov 11, 2026, 1:42 p.m. PCT".
// Times before the change carry the zone they were in then (PST or PDT).
export function fmtBcDateTime(iso: string): string {
  const at = new Date(iso);
  const zone = bcTimeZone(at);
  const shown = at.toLocaleString("en-CA", { timeZone: zone, dateStyle: "medium", timeStyle: "short" });
  return `${shown} ${zoneAbbreviation(at, zone)}`;
}

function zoneAbbreviation(at: Date, zone: string): string {
  if (zone === PERMANENT_ZONE) return "PCT";
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? "PT";
}
