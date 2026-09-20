import { createHash } from "node:crypto";
import { getTableColumns, sql, type Table } from "drizzle-orm";
import { db, type Database } from "@/db";
import {
  admins,
  appSettings,
  channelFollowers,
  channelModerators,
  channelPointRedemptions,
  channelPointRewards,
  equippedTokens,
  eventTypes,
  feedbackReports,
  subscriptions,
  tokens,
  tokenVariants,
  userTokens,
  users,
} from "@/db/schema";
import journal from "../../drizzle/meta/_journal.json";
import packageJson from "../../package.json";

/**
 * Versione del formato del file.
 * 1 = primo formato (senza varianti né checksum), ancora importabile.
 * 2 = aggiunge token_variants, schema del database e checksum SHA-256.
 */
export const BACKUP_FORMAT = 2;
const SUPPORTED_FORMATS = [1, 2];

/** Ultima migrazione applicata a questo codice: dice con che schema è stato creato un backup. */
export const SCHEMA_TAG = journal.entries.at(-1)!.tag;
const SCHEMA_TAGS = journal.entries.map((entry) => entry.tag);

/**
 * Tabelle salvate nel backup, in ordine di inserimento (le chiavi esterne puntano sempre indietro).
 * Esclusi di proposito: audit_log ed eventsub_messages (storico tecnico), overlay_events (coda
 * effimera) e broadcaster_auth, che contiene i token OAuth cifrati con la chiave di questa
 * installazione e non avrebbe senso spostare altrove.
 */
const TABLES = [
  ["users", users],
  ["event_types", eventTypes],
  ["tokens", tokens],
  ["token_variants", tokenVariants],
  ["user_tokens", userTokens],
  ["equipped_tokens", equippedTokens],
  ["subscriptions", subscriptions],
  ["channel_followers", channelFollowers],
  ["channel_moderators", channelModerators],
  ["admins", admins],
  ["channel_point_rewards", channelPointRewards],
  ["channel_point_redemptions", channelPointRedemptions],
  ["app_settings", appSettings],
  ["feedback_reports", feedbackReports],
] as const satisfies readonly (readonly [string, Table])[];

export type TableName = (typeof TABLES)[number][0];
export const TABLE_NAMES: TableName[] = TABLES.map(([name]) => name);

type Row = Record<string, unknown>;

/**
 * Tabelle nate dopo il primo formato, con la migrazione che le ha introdotte:
 * un backup creato prima di quella migrazione non le contiene, e vanno considerate vuote.
 */
const TABLE_SINCE: Partial<Record<TableName, string>> = {
  token_variants: "0005_variants_secret_artist",
  feedback_reports: "0007_feedback_reports",
  event_types: "0008_event_types",
};

/** Il backup è stato creato prima che esistesse la tabella? */
function predates(file: Partial<BackupFile>, table: TableName): boolean {
  const since = TABLE_SINCE[table];
  if (!since) return false;
  // Il formato 1 non registrava lo schema: le varianti esistevano già ma non venivano salvate.
  if (file.chronos === 1) return true;
  return SCHEMA_TAGS.indexOf(file.schema ?? "") < SCHEMA_TAGS.indexOf(since);
}

export type BackupFile = {
  chronos: number;
  version: string;
  /** Tag dell'ultima migrazione dello schema da cui è stato esportato (dal formato 2). */
  schema?: string;
  exportedAt: string;
  counts: Record<string, number>;
  /** SHA-256 di JSON.stringify(tables) (dal formato 2). */
  checksum?: string;
  tables: Record<string, Row[]>;
};

export function checksumOf(tables: BackupFile["tables"]): string {
  return createHash("sha256").update(JSON.stringify(tables)).digest("hex");
}

/** Istantanea completa del database, letta in una sola transazione perché sia coerente. */
export async function exportBackup(): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  const counts: Record<string, number> = {};

  await db.transaction(async (tx: Database) => {
    for (const [name, table] of TABLES) {
      const rows = (await tx.select().from(table)) as Row[];
      tables[name] = rows;
      counts[name] = rows.length;
    }
  });

  // JSON.parse(JSON.stringify(...)): le date diventano stringhe ISO prima del checksum,
  // così il valore coincide con quello ricalcolato sul file riletto.
  const serialized = JSON.parse(JSON.stringify(tables)) as BackupFile["tables"];
  return {
    chronos: BACKUP_FORMAT,
    version: packageJson.version,
    schema: SCHEMA_TAG,
    exportedAt: new Date().toISOString(),
    counts,
    checksum: checksumOf(serialized),
    tables: serialized,
  };
}

/** Righe per tabella del database attuale, senza leggere i dati. */
export async function currentCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, table] of TABLES) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    counts[name] = Number(n);
  }
  return counts;
}

export class BackupValidationError extends Error {}

function fail(message: string): never {
  throw new BackupValidationError(message);
}

/**
 * Controlli strutturali, senza toccare il database: formato, versione dello schema,
 * checksum, tabelle, colonne e conteggi. Restituisce il file normalizzato al formato attuale.
 */
export function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Il file non è un JSON valido: potrebbe essere danneggiato o non essere un backup.");
  }

  const file = parsed as Partial<BackupFile> | null;
  if (!file || typeof file !== "object" || typeof file.tables !== "object" || file.tables === null) {
    fail("Questo file non è un backup di Chronos.");
  }
  if (typeof file.chronos !== "number" || !SUPPORTED_FORMATS.includes(file.chronos)) {
    fail(`Formato di backup non supportato (${String(file.chronos)}).`);
  }

  if (file.chronos >= 2) {
    if (typeof file.schema !== "string" || !SCHEMA_TAGS.includes(file.schema)) {
      fail(
        `Il backup è stato creato con uno schema del database sconosciuto (${String(file.schema)}): ` +
          "probabilmente da una versione di Chronos più recente di questa.",
      );
    }
    if (typeof file.checksum !== "string") fail("Nel backup manca il checksum di integrità.");
    if (checksumOf(file.tables) !== file.checksum) {
      fail("Il checksum non corrisponde: il file è stato modificato o è danneggiato.");
    }
  }

  const tables: BackupFile["tables"] = {};
  for (const [name, table] of TABLES) {
    let rows = file.tables[name];
    // Tabella più recente del backup: parte vuota (per le varianti, le scelte tornano all'artwork principale).
    if (rows === undefined && predates(file, name)) rows = [];
    if (!Array.isArray(rows)) fail(`Nel backup manca la tabella "${name}".`);

    const columns = new Set(Object.keys(getTableColumns(table)));
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        fail(`Tabella "${name}", riga ${index + 1}: non è un record valido.`);
      }
      for (const key of Object.keys(row)) {
        if (!columns.has(key)) fail(`Tabella "${name}": colonna sconosciuta "${key}".`);
      }
    }
    if (file.counts && typeof file.counts[name] === "number" && file.counts[name] !== rows.length) {
      fail(`Tabella "${name}": attese ${file.counts[name]} righe, trovate ${rows.length}. File incompleto.`);
    }
    tables[name] = rows;
  }

  if (file.chronos === 1) {
    tables.user_tokens = tables.user_tokens.map((row) => ({ ...row, variantId: null }));
  }

  return {
    chronos: file.chronos,
    version: typeof file.version === "string" ? file.version : "?",
    schema: file.schema,
    exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : new Date(0).toISOString(),
    counts: Object.fromEntries(TABLE_NAMES.map((name) => [name, tables[name].length])),
    checksum: file.checksum,
    tables,
  };
}

/** Dal JSON le date arrivano come stringhe: le riconvertiamo solo nelle colonne timestamp. */
function reviveRow(table: Table, row: Row): Row {
  const columns = getTableColumns(table);
  const revived: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const isTimestamp = columns[key]?.columnType === "PgTimestamp";
    revived[key] = isTimestamp && typeof value === "string" ? new Date(value) : value;
  }
  return revived;
}

/**
 * Messaggio leggibile da un errore del database. Drizzle avvolge l'errore di Postgres in un
 * "Failed query" che riporta l'intera istruzione con i dati: qui teniamo solo la causa.
 */
export function describeDbError(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  if (!(current instanceof Error)) return String(current);
  const detail = (current as { detail?: unknown }).detail;
  return typeof detail === "string" && detail ? `${current.message} (${detail})` : current.message;
}

const CHUNK = 500;
/** Errore usato solo per annullare la transazione della prova a secco. */
class DryRunRollback extends Error {}

/** Un solo ripristino alla volta in questo processo; il lock di Postgres copre il resto. */
let restoring = false;

async function replaceAll(tx: Database, file: BackupFile): Promise<Record<string, number>> {
  // Lock di transazione: due ripristini concorrenti non possono intrecciarsi.
  await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);

  // Ordine inverso: si cancella prima chi ha le chiavi esterne.
  for (const [, table] of [...TABLES].reverse()) await tx.delete(table);

  const applied: Record<string, number> = {};
  for (const [name, table] of TABLES) {
    const rows = file.tables[name].map((row) => reviveRow(table, row));
    for (let i = 0; i < rows.length; i += CHUNK) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx.insert(table).values(rows.slice(i, i + CHUNK) as any);
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(table);
    if (Number(n) !== rows.length) {
      throw new Error(`Tabella "${name}": inserite ${n} righe invece di ${rows.length}.`);
    }
    applied[name] = rows.length;
  }
  return applied;
}

/**
 * Prova a secco: applica il backup dentro una transazione e poi la annulla sempre.
 * È la verifica più affidabile possibile: vincoli, chiavi esterne e tipi vengono
 * controllati da Postgres stesso, senza che il database cambi di una virgola.
 */
export async function dryRunRestore(file: BackupFile): Promise<void> {
  try {
    await db.transaction(async (tx: Database) => {
      await replaceAll(tx, file);
      throw new DryRunRollback();
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return;
    fail(`Il database rifiuterebbe questo backup: ${describeDbError(error)}`);
  }
}

/**
 * Ripristino completo in un'unica transazione: o si applica tutto, o non si applica nulla.
 * Postgres annulla da solo la transazione se una qualsiasi istruzione fallisce.
 */
export async function restoreBackup(file: BackupFile): Promise<Record<string, number>> {
  if (restoring) throw new Error("C'è già un ripristino in corso: attendi che finisca.");
  restoring = true;
  try {
    return await db.transaction((tx: Database) => replaceAll(tx, file));
  } finally {
    restoring = false;
  }
}

export function isRestoreInProgress(): boolean {
  return restoring;
}
