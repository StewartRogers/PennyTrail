import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "../helpers/fixtures";

// An in-memory stand-in for the one pennytrail_store row, speaking just
// enough of the SQL storePostgres.ts sends to check its transaction handling
// (lock, commit, rollback) without a real database.
const db = vi.hoisted(() => ({
  row: undefined as unknown,
  pending: undefined as unknown,
  statements: [] as string[],
  released: 0,
  failWith: null as null | { code: string },
}));

vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));

vi.mock("pg", () => {
  async function query(sql: string, params: unknown[] = []) {
    db.statements.push(sql.replace(/\s+/g, " ").trim());
    if (db.failWith) throw Object.assign(new Error("db failure"), db.failWith);
    if (sql.startsWith("SELECT doc")) return { rows: db.row === undefined ? [] : [{ doc: structuredClone(db.row) }] };
    if (sql.startsWith("INSERT INTO pennytrail_store")) {
      if (sql.includes("DO NOTHING")) db.row ??= JSON.parse(params[1] as string);
      else db.row = JSON.parse(params[1] as string);
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE pennytrail_store")) db.pending = JSON.parse(params[1] as string);
    if (sql === "COMMIT" && db.pending !== undefined) db.row = db.pending;
    if (sql === "COMMIT" || sql === "ROLLBACK") db.pending = undefined;
    return { rows: [] };
  }
  class Pool {
    query = query;
    async connect() {
      return { query, release: () => db.released++ };
    }
  }
  return { Pool, default: { Pool } };
});

beforeEach(() => {
  vi.resetModules();
  Object.assign(db, { row: undefined, pending: undefined, statements: [], released: 0, failWith: null });
  vi.stubEnv("DATABASE_URL", "postgres://user:pw@example.neon.tech/db?sslmode=require");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const load = () => import("@/lib/storePostgres");

describe("Postgres store", () => {
  it("reads an empty state, without writing, before anything is saved", async () => {
    const { readState } = await load();
    const state = await readState();
    expect(state.transactions).toEqual([]);
    expect(state.categories.length).toBeGreaterThan(0);
    expect(db.row).toBeUndefined();
  });

  it("creates the row on the first save and locks it before changing it", async () => {
    const { updateState } = await load();
    await updateState((s) => {
      s.cards.push(makeCard({ id: "c1" }));
    });
    expect((db.row as { cards: unknown[] }).cards).toHaveLength(1);
    const lock = db.statements.findIndex((s) => s.includes("FOR UPDATE"));
    const update = db.statements.findIndex((s) => s.startsWith("UPDATE pennytrail_store"));
    expect(lock).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(lock);
    expect(db.statements.at(-1)).toBe("COMMIT");
    expect(db.released).toBe(1);
  });

  // The store contract: a mutator returning { error } persists nothing, even
  // if it changed the state before bailing out.
  it("rolls back when the mutator returns an error", async () => {
    const { updateState } = await load();
    await updateState((s) => void s.cards.push(makeCard({ id: "keep" })));
    const { result } = await updateState((s) => {
      s.cards = [];
      return { error: "nope" };
    });
    expect(result).toEqual({ error: "nope" });
    expect((db.row as { cards: { id: string }[] }).cards.map((c) => c.id)).toEqual(["keep"]);
    expect(db.statements.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back, releases the connection, and rethrows when the mutator throws", async () => {
    const { updateState } = await load();
    await expect(
      updateState(() => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(db.statements.at(-1)).toBe("ROLLBACK");
    expect(db.released).toBe(1);
  });

  it("explains a missing schema instead of surfacing a raw SQL error", async () => {
    db.failWith = { code: "42P01" };
    const { readState } = await load();
    await expect(readState()).rejects.toThrow(/npm run db:migrate/);
  });

  it("spells sslmode=require as verify-full (same check, no pg warning)", async () => {
    const { withVerifiedTls } = await load();
    expect(withVerifiedTls("postgres://h/db?sslmode=require&channel_binding=require")).toBe(
      "postgres://h/db?sslmode=verify-full&channel_binding=require"
    );
    expect(withVerifiedTls("postgres://h/db?a=1&sslmode=require")).toBe("postgres://h/db?a=1&sslmode=verify-full");
  });
});

describe("store backend selection", () => {
  it("routes to Postgres when PENNYTRAIL_STORAGE=postgres", async () => {
    vi.stubEnv("PENNYTRAIL_STORAGE", "postgres");
    const { updateState } = await import("@/lib/store");
    await updateState((s) => void s.templates.push({ id: "t1" } as never));
    expect((db.row as { templates: unknown[] }).templates).toHaveLength(1);
  });

  it("refuses an unknown backend", async () => {
    vi.stubEnv("PENNYTRAIL_STORAGE", "sqlite");
    const { readState } = await import("@/lib/store");
    await expect(readState()).rejects.toThrow(/PENNYTRAIL_STORAGE/);
  });

  // On Vercel the file store would lose every write; better to refuse.
  it("refuses the file store on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const { readState } = await import("@/lib/store");
    await expect(readState()).rejects.toThrow(/must be set on Vercel/);
  });
});
