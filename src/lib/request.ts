// Shared request-body helpers for the API routes.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Route handlers all expect a JSON *object* of fields. `request.json()`
// rejects on a malformed body — which the routes already guarded — but it
// *succeeds* on the literal body `null`, on a bare array, and on a bare
// primitive. Each of those then threw a TypeError on the first field access
// (`body.name`), escaping the handler as a 500 with a dev stack trace, where
// the intended answer was a 400 from the route's own required-field check.
// Normalizing every unusable shape to `{}` lets those checks do their job.
export async function readJsonObject(request: Request): Promise<Record<string, any>> {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, any>;
}

// A field that must be user-supplied text. `String(body.name || "")` accepted
// anything: `{}` became the literal card name "[object Object]" and an array
// became a comma-joined string, both persisted with a 201. Only real strings
// count; everything else reads as absent so the caller's `if (!name)` fires.
export function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Nothing here is a real limit for a personal-finance tool, but every
// mutation re-serializes the entire store, so an unbounded string is a
// permanent tax on every later request. Names past this are a client bug or a
// hostile request, not a nickname.
export const MAX_NAME_LENGTH = 200;

// A yyyy-mm-dd string naming a day the calendar actually has. The bare
// pattern check let "2024-13-45" through import, where it was stored and then
// rendered as nothing and bucketed into a month that doesn't exist.
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, mo, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
