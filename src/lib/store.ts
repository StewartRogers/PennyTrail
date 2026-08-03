import { mkdir, readFile, rename, writeFile } from "fs/promises";
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
  await writeFile(tmpFile, JSON.stringify(state, null, 2), "utf-8");
  await renameWithRetry(tmpFile, DATA_FILE);
}

export function readState(): Promise<AppState> {
  return enqueue(readStateUnqueued);
}

export function writeState(state: AppState): Promise<void> {
  return enqueue(() => writeStateUnqueued(state));
}

export function updateState<T>(mutator: (state: AppState) => T): Promise<{ state: AppState; result: T }> {
  return enqueue(async () => {
    const state = await readStateUnqueued();
    const result = mutator(state);
    await writeStateUnqueued(state);
    return { state, result };
  });
}
