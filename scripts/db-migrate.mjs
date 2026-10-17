// Applies db/schema.sql (idempotent) to the Postgres database.
//
//   npm run db:migrate
//
// Reads DATABASE_URL_UNPOOLED (the direct connection Neon recommends for
// schema changes), falling back to DATABASE_URL, from the environment or
// .env.local — `vercel env pull` writes both there.
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const SCHEMA = fileURLToPath(new URL("../db/schema.sql", import.meta.url));

export function directConnectionString() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("No DATABASE_URL_UNPOOLED or DATABASE_URL — run `npx vercel env pull .env.local` first");
  }
  // Same as storePostgres.ts's withVerifiedTls: pg already verifies the
  // certificate for sslmode=require, but warns unless it's spelled verify-full.
  return url.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

export async function applySchema(client) {
  await client.query(await readFile(SCHEMA, "utf-8"));
}

async function main() {
  const client = new pg.Client({ connectionString: directConnectionString() });
  await client.connect();
  try {
    await applySchema(client);
    console.log("Schema is up to date (db/schema.sql applied).");
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
