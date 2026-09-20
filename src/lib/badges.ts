/** Distintivo di accesso mostrato come anello colorato attorno a nome e avatar. */
export type AccessBadge = "broadcaster" | "editor" | null;

/**
 * Lo streamer del canale ha l'anello rosso, chi può modificare i contenuti (pannello Manager)
 * l'anello verde acqua. Nessun tag nell'header: parla il colore.
 */
export function accessBadge(viewer: { isAdmin: boolean; role: "broadcaster" | "moderator" | null }): AccessBadge {
  if (viewer.role === "broadcaster") return "broadcaster";
  if (viewer.isAdmin) return "editor";
  return null;
}

export const BADGE_RING: Record<NonNullable<AccessBadge>, string> = {
  broadcaster: "border-streamer shadow-[0_0_18px_-6px_var(--color-streamer)]",
  editor: "border-editor shadow-[0_0_18px_-6px_var(--color-editor)]",
};

export const BADGE_TEXT: Record<NonNullable<AccessBadge>, string> = {
  broadcaster: "text-streamer",
  editor: "text-editor",
};
