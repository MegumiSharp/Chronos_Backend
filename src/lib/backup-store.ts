import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBackup, type BackupFile } from "./backup";

/**
 * Archivio dei backup su disco, fuori dal database: se il database si corrompe
 * i backup restano leggibili. In produzione la cartella è un bind mount sul NAS.
 * Percorso fisso: uno dinamico farebbe includere al build l'intero progetto.
 */
export const BACKUP_DIR = path.join(process.cwd(), ".data", "backups");

/**
 * manual: creato dal pannello · auto: dal backup pianificato · safety: automatico prima di
 * un ripristino · imported: caricato da file.
 */
export type BackupKind = "manual" | "auto" | "safety" | "imported";
const KINDS: BackupKind[] = ["manual", "auto", "safety", "imported"];

/** Nome file: 20260917-101500-manual-a1b2c3.json. L'id è il nome senza estensione. */
const ID_PATTERN = /^(\d{8}-\d{6})-(manual|auto|safety|imported)-([0-9a-f]{6})$/;

export type StoredBackup = {
  id: string;
  kind: BackupKind;
  createdAt: Date;
  /** Data dell'istantanea contenuta (per gli importati è quella originale). */
  exportedAt: string;
  version: string;
  schema: string | null;
  sizeBytes: number;
  counts: Record<string, number>;
  totalRows: number;
  /** Se il file non supera più i controlli (es. modificato a mano sul disco). */
  error: string | null;
};

function stampOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

function dateOf(stamp: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** Percorso sicuro: accetta solo id nel formato atteso, mai percorsi arbitrari. */
function fileFor(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Identificativo di backup non valido.");
  return path.join(BACKUP_DIR, `${id}.json`);
}

/**
 * Scrive il backup e lo rilegge per verificarlo prima di considerarlo salvato.
 * La scrittura passa da un file temporaneo + rename: non resta mai un file a metà.
 */
export async function saveBackup(file: BackupFile, kind: BackupKind): Promise<StoredBackup> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const id = `${stampOf(new Date())}-${kind}-${randomBytes(3).toString("hex")}`;
  const target = fileFor(id);
  const temp = `${target}.tmp`;

  await writeFile(temp, JSON.stringify(file), { encoding: "utf8", mode: 0o600, flush: true });
  try {
    parseBackup(await readFile(temp, "utf8"));
  } catch (error) {
    await rm(temp, { force: true });
    throw new Error(`Il backup scritto su disco non supera la verifica: ${(error as Error).message}`);
  }
  await rename(temp, target);

  const stored = await describe(id);
  if (!stored || stored.error) throw new Error("Il backup salvato non è leggibile.");
  return stored;
}

export async function readStoredBackup(id: string): Promise<{ raw: string; file: BackupFile }> {
  const raw = await readFile(fileFor(id), "utf8");
  return { raw, file: parseBackup(raw) };
}

async function describe(id: string): Promise<StoredBackup | null> {
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  const full = fileFor(id);
  const info = await stat(full).catch(() => null);
  if (!info) return null;

  const base = {
    id,
    kind: match[2] as BackupKind,
    createdAt: dateOf(match[1]),
    sizeBytes: info.size,
  };
  try {
    const file = parseBackup(await readFile(full, "utf8"));
    return {
      ...base,
      exportedAt: file.exportedAt,
      version: file.version,
      schema: file.schema ?? null,
      counts: file.counts,
      totalRows: Object.values(file.counts).reduce((sum, n) => sum + n, 0),
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      exportedAt: base.createdAt.toISOString(),
      version: "?",
      schema: null,
      counts: {},
      totalRows: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Storico, dal più recente. */
export async function listBackups(): Promise<StoredBackup[]> {
  const names = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  const described = await Promise.all(ids.map(describe));
  return described
    .filter((b): b is StoredBackup => b !== null && KINDS.includes(b.kind))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function deleteBackup(id: string): Promise<void> {
  await rm(fileFor(id));
}

export function isBackupId(id: string): boolean {
  return ID_PATTERN.test(id);
}
