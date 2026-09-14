import { Pool, types, type QueryResultRow } from "pg";

/* Postgres DATE has no time and no zone, but node-postgres turns it into a JS
   Date at LOCAL midnight — so a server east of UTC reads 2026-03-01 back as
   2026-02-28 the moment anything converts it to ISO. Hand DATE back as the
   plain "YYYY-MM-DD" string it already is. (1082 = DATE.) */
types.setTypeParser(1082, v => v);
import { connectionString, sslFor } from "./db-url";

/* One pool per process. Next.js hot-reloads modules in dev, so stash it on
   globalThis or every reload leaks a pool. */
const g = globalThis as unknown as { _pool?: Pool };

function pool(): Pool {
  if (!g._pool) {
    const url = connectionString();
    g._pool = new Pool({
      connectionString: url,
      ssl: sslFor(url),
      // PGlite's dev socket server accepts one connection at a time; Neon wants several.
      max: Number(process.env.DB_POOL_MAX || 5),
      // Drop idle sockets quickly: the dev server closes them, and a reused
      // dead socket surfaces as ECONNRESET on the next query.
      idleTimeoutMillis: Number(process.env.DB_IDLE_MS || 10_000),
      connectionTimeoutMillis: 10_000,
    });
    // An idle client erroring must not take the process down.
    g._pool.on("error", err => console.error("[db] idle client error:", err.message));
  }
  return g._pool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Runs the callback inside a transaction, rolling back on any throw. */
export async function tx<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
