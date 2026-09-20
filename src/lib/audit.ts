/**
 * Registro attività: ogni azione dello staff lascia una riga in `audit_log`,
 * consultabile in Manager → Registro. Serve a sapere chi ha fatto cosa, e su cosa:
 * non a ricostruire lo stato, ma a ritrovare in fretta la modifica che ha rotto qualcosa.
 */
import type { Database } from "@/db";
import { auditLog } from "@/db/schema";

/** Cosa ha subito l'azione: guida i filtri del registro. */
export type AuditTarget =
  | "token"
  | "user"
  | "event_type"
  | "admin"
  | "feedback"
  | "channel_point_reward"
  | "overlay"
  | "twitch"
  | "backup"
  | "chat_bot";

/** Campo modificato, com'era e com'è diventato. */
export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

export type AuditEntry = {
  actorUserId?: string | null;
  /** Sempre "soggetto.verbo", es. token.updated: il verbo finale diventa il filtro per tipo. */
  action: string;
  targetType?: AuditTarget;
  targetId?: string;
  /** Nome leggibile del bersaglio, congelato al momento dell'azione. */
  label?: string | null;
  /** Utente su cui ricade l'azione (assegnazioni, revoche, accessi). */
  subjectUserId?: string | null;
  changes?: AuditChanges;
  data?: Record<string, unknown> | unknown[] | null;
};

/** Va chiamata dentro la stessa transazione dell'azione, così o si salvano entrambe o nessuna. */
export async function audit(db: Database, entry: AuditEntry): Promise<void> {
  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0;
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    label: entry.label ?? null,
    subjectUserId: entry.subjectUserId ?? null,
    data: hasChanges ? { ...(entry.data as object | null), changes: entry.changes } : (entry.data ?? null),
  });
}

/** I campi che non vale la pena registrare: cambiano a ogni salvataggio o sono rumore. */
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id"]);

/**
 * Differenza fra il record prima e dopo, con i soli campi cambiati.
 * Le date si confrontano sul valore, non sull'identità dell'oggetto.
 */
export function diffFields<T extends Record<string, unknown>>(before: T | null | undefined, after: T): AuditChanges {
  const changes: AuditChanges = {};
  if (!before) return changes;
  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const from = normalise(before[key]);
    const to = normalise(after[key]);
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

function normalise(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | boolean;
}
