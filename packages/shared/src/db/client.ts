import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema.js";

// Node needs a WebSocket polyfill for Neon's serverless driver; browsers/Edge
// supply their own. Guarded so the module stays importable from the browser.
if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  neonConfig.webSocketConstructor = ws as any;
}

let cachedPool: Pool | undefined;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazy db + pool. We avoid instantiating at module load so serverless cold
 * starts don't open a socket before the handler actually needs one, and so
 * tests can mock DATABASE_URL after import.
 *
 * Callers must `await getDb()`'s transaction wrapper for atomic read-modify-write
 * (the file-lock equivalent in Postgres is `BEGIN ISOLATION LEVEL SERIALIZABLE`).
 */
export function getDb() {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set — required for Postgres-backed state. " +
        "Get a connection string from https://console.neon.tech and export it."
    );
  }
  cachedPool = new Pool({ connectionString: url });
  cachedDb = drizzle(cachedPool, { schema });
  return cachedDb;
}

export function getPool(): Pool {
  if (!cachedPool) getDb();
  return cachedPool!;
}

/**
 * Close the pool. Safe to call on agent shutdown to let in-flight sockets
 * flush cleanly. No-op if getDb() was never called.
 */
export async function closeDb(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = undefined;
    cachedDb = undefined;
  }
}
