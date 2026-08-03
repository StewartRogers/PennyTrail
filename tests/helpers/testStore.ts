import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

// Route handlers read PENNYTRAIL_DATA_DIR through src/lib/store.ts's
// top-level DATA_DIR constant, which is only evaluated once per module
// instance — so each test needs its own scratch directory AND a fresh
// module instance (vi.resetModules()) to pick it up. Callers must
// dynamically `await import(...)` the route/store module fresh inside each
// test (or in a beforeEach registered after this one) rather than using a
// static top-level import, or they'll get a stale, already-cached instance
// pointed at a previous test's directory.
export function setupScratchDataDir(): { dir: () => string } {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pennytrail-test-"));
    process.env.PENNYTRAIL_DATA_DIR = dir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.PENNYTRAIL_DATA_DIR;
  });

  return { dir: () => dir };
}

export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
