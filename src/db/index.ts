import { createDatabaseClient, type Database } from "./client";

export type { Database } from "./client";
export * as schema from "./schema";

const globalForDb = globalThis as unknown as { __chronosDb?: Database };

function getDatabase(): Database {
  // Riutilizzato tra gli hot reload di sviluppo: PGlite non può aprire due volte la stessa cartella.
  globalForDb.__chronosDb ??= createDatabaseClient().db as unknown as Database;
  return globalForDb.__chronosDb;
}

/** Connessione creata al primo utilizzo, così `next build` non richiede un database raggiungibile. */
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDatabase();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
