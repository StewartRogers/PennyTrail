import { mkdir, open, readFile, rename, unlink } from "fs/promises";
import path from "path";
import type { AppState } from "./types";
import { defaultCategories } from "./categories";

// Overridable so verification/test runs can point at a scratch directory
// instead of the real store — defaults to the normal on-disk location.
const DATA_DIR = process.env.PENNYTRAIL_DATA_DIR
  ? path.resolve(process.env.PENNYTRAIL_DATA_DIR)
  : path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function emptyState(): AppState {
  return {
    cards: [],
    categories: defaultCategories(),
    templates: [],
    parentVendors: [],
    childVendors: [],
    transactions: [],
  };
}

// Serializes every read and write through one queue, so concurrent requests
// can't interleave a read-modify-write cycle (lost updates) or observe a
// half-written file (writeFile alone truncates in place, which isn't atomic —
// writes go through a temp file + rename instead).
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

async function readStateUnqueued(): Promise<AppState> {
  let raw: string;
  try {
    raw = await readFile(DATA_FILE, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const initial = emptyState();
      await writeStateUnqueued(initial);
      return initial;
    }
    throw err;
  }
  try {
    return JSON.parse(raw) as AppState;
  } catch (err: unknown) {
    // A hand-edited or partially-written store.json throws an opaque
    // "Unexpected token" error otherwise — every route surfaces this as a
    // generic 500 with no indication of what's actually wrong or where the
    // file lives, since this is the one place that reads it.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${DATA_FILE} is not valid JSON (${message}) — fix or restore it from a backup before retrying`);
  }
}

// On Windows, renaming onto DATA_FILE can transiently fail with EPERM/EBUSY
// when antivirus, search indexing, or an editor briefly holds a handle on
// the file right after it's written — the lock clears within milliseconds,
// so a few short retries ride it out instead of failing the whole request.
async function renameWithRetry(src: string, dest: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rename(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === maxAttempts || (code !== "EPERM" && code !== "EBUSY")) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

async function writeStateUnqueued(state: AppState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  // fsync the temp file before renaming it into place. Without this the
  // rename can reach disk while the file's contents haven't, so a power loss
  // or kernel panic in that window leaves store.json empty or truncated —
  // which readStateUnqueued can only report as "not valid JSON", with the
  // user's whole transaction history gone. The rename itself stays atomic for
  // concurrent readers either way.
  const handle = await open(tmpFile, "w");
  try {
    await handle.writeFile(JSON.stringify(state, null, 2), "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(tmpFile, DATA_FILE);
  } catch (err) {
    // Don't leave the scratch file behind if the rename ultimately failed.
    await unlink(tmpFile).catch(() => {});
    throw err;
  }
}

export function readState(): Promise<AppState> {
  return enqueue(readStateUnqueued);
}

export function writeState(state: AppState): Promise<void> {
  return enqueue(() => writeStateUnqueued(state));
}

// Every route signals rejection by returning a discriminated `{ error }`
// object from its mutator and mapping that to a status code. A mutator that
// bails out partway can already have mutated `state` before it hit the
// failing check, so writing unconditionally would persist the changes made by
// a request the caller was told had failed (e.g. PATCH /api/transactions/[id]
// sets txn.type before it validates parentId, so a 400 response still left
// the type change on disk). Treat an `error` key as "abort": drop the mutated
// state without writing, and let the next read re-parse from disk.
function isAbort(result: unknown): boolean {
  return typeof result === "object" && result !== null && "error" in result;
}

export function updateState<T>(mutator: (state: AppState) => T): Promise<{ state: AppState; result: T }> {
  return enqueue(async () => {
    const state = await readStateUnqueued();
    const result = mutator(state);
    if (!isAbort(result)) await writeStateUnqueued(state);
    return { state, result };
  });
}
