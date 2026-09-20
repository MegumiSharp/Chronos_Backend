export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

/** Login di prova senza Twitch: mai attivo in produzione. */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "true";
}

export function envAdminTwitchIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_TWITCH_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
