import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export const PGLITE_DIR = ".data/pglite";

export type DatabaseClient =
  | { kind: "pglite"; db: PgliteDatabase<Schema>; close: () => Promise<void> }
  | { kind: "postgres"; db: PostgresJsDatabase<Schema>; close: () => Promise<void> };

/**
 * Senza DATABASE_URL (solo sviluppo) usa PGlite su disco: nessun Postgres da installare.
 * Nota: PGlite è single-process, quindi ferma `npm run dev` prima di migrate/seed.
 */
export function createDatabaseClient(): DatabaseClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL non impostata: in produzione serve un database Postgres.");
    }
    mkdirSync(PGLITE_DIR, { recursive: true });
    const client = new PGlite(PGLITE_DIR);
    return { kind: "pglite", db: drizzlePglite({ client, schema }), close: () => client.close() };
  }
  // prepare: false mantiene la compatibilità con i pooler in transaction mode (Neon, Supabase).
  const client = postgres(url, { prepare: false, max: 5 });
  return { kind: "postgres", db: drizzlePostgres({ client, schema }), close: () => client.end() };
}
