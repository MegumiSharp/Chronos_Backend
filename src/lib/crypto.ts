/**
 * Cifratura dei token OAuth di Twitch (broadcaster e bot) prima di salvarli nel database:
 * chi legge il database non ottiene credenziali utilizzabili.
 *
 * Formato: `v1.<iv>.<tag>.<dati>`, tutto in base64url. Il prefisso di versione permette
 * di cambiare algoritmo in futuro senza confondere i valori già salvati.
 * La chiave è TOKEN_ENCRYPTION_KEY: se la si perde, i collegamenti Twitch vanno rifatti.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

function encryptionKey(): Buffer {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY deve essere di 32 byte in base64.");
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segreto cifrato in formato non valido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
