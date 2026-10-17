// Copies a local store file into the Postgres database, once, so the Vercel
// deployment starts with your existing history.
//
//   npm run db:import                       # imports data/store.json
//   npm run db:import -- path/to/store.json
//   npm run db:import -- --force            # replace data already in the database
//
// Refuses to overwrite a database that already holds data unless --force is
// given: after go-live the database, not the local file, is the live copy.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { applySchema, directConnectionString } from "./db-migrate.mjs";

const COLLECTIONS = ["cards", "categories", "templates", "parentVendors", "childVendors", "transactions"];
// Collections that only ever hold the user's own data (categories start with
// defaults, so they don't count as "already has data").
const USER_DATA = ["cards", "templates", "parentVendors", "childVendors", "transactions"];

function summarize(doc) {
  return COLLECTIONS.map((key) => `${Array.isArray(doc?.[key]) ? doc[key].length : 0} ${key}`).join(", ");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--")) ?? "data/store.json";

  const doc = JSON.parse(await readFile(file, "utf-8"));
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${file} does not contain a store object`);
  for (const key of COLLECTIONS) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) throw new Error(`${file}: "${key}" is not a list`);
  }

  const client = new pg.Client({ connectionString: directConnectionString() });
  await client.connect();
  try {
    await applySchema(client);
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT doc FROM pennytrail_store WHERE id = 1 FOR UPDATE");
    const existing = rows[0]?.doc;
    if (existing && USER_DATA.some((key) => existing[key]?.length) && !force) {
      await client.query("ROLLBACK");
      console.error(`The database already has data (${summarize(existing)}).`);
      console.error("Nothing was changed. Re-run with --force to replace it with the file.");
      process.exitCode = 1;
      return;
    }
    await client.query(
      `INSERT INTO pennytrail_store (id, doc) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [JSON.stringify(doc)]
    );
    await client.query("COMMIT");
    console.log(`Imported ${file}: ${summarize(doc)}.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
