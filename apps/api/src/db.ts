import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

export const pool = env.databaseUrl
  ? new pg.Pool({
      connectionString: env.databaseUrl,
      max: 10,
      ssl: /sslmode=require|supabase|railway\.app|rlwy\.net/.test(env.databaseUrl) && !/localhost|127\.0\.0\.1/.test(env.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    })
  : null;

// An idle client losing its connection must not crash the process (pg emits 'error' on the pool).
pool?.on("error", (e) => console.warn("[db] idle client error:", e.message));

// bigint columns come back as strings — keep them as strings and convert explicitly.
export function db() {
  if (!pool) throw new Error("DATABASE_URL not configured");
  return pool;
}

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await db().query<T>(text, params)).rows;
}

/** Run fn inside a transaction. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate() {
  if (!pool) return;
  const schemaPath = fileURLToPath(new URL("../../../db/schema.sql", import.meta.url));
  await pool.query(readFileSync(schemaPath, "utf8"));
  console.log("[db] schema ok");
}
