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
    vendorRules: [],
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
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw) as AppState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const initial = emptyState();
      await writeStateUnqueued(initial);
      return initial;
    }
    throw err;
  }
}

async function writeStateUnqueued(state: AppState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpFile, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmpFile, DATA_FILE);
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
