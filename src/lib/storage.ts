/**
 * Dove finiscono gli artwork dei token. Due implementazioni dietro la stessa interfaccia:
 * in sviluppo file su disco in `.data/uploads`, in produzione un bucket S3/R2
 * (STORAGE_DRIVER=s3). Il resto del codice non sa quale delle due sta usando.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "./env";

/** Le chiavi sono percorsi tipo `tokens/<slug>-<casuale>/512.webp`. */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  publicUrl(key: string): string;
}

/** Solo sviluppo: file in .data/uploads serviti dalla route /media/[...key]. */
export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

/** La chiave arriva da un URL: senza questo controllo un `../` leggerebbe fuori dalla cartella. */
function safeLocalPath(key: string): string {
  const resolved = path.resolve(LOCAL_UPLOAD_DIR, key);
  if (!resolved.startsWith(LOCAL_UPLOAD_DIR + path.sep)) throw new Error("Chiave storage non valida.");
  return resolved;
}

export async function readLocalObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(safeLocalPath(key));
  } catch {
    return null;
  }
}

const localStorage: Storage = {
  async put(key, body) {
    const file = safeLocalPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async delete(keys) {
    await Promise.all(keys.map((key) => rm(safeLocalPath(key), { force: true })));
  },
  publicUrl(key) {
    return `/media/${key}`;
  },
};

function createS3Storage(): Storage {
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: requireEnv("S3_ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = requireEnv("S3_BUCKET");
  const publicBase = requireEnv("S3_PUBLIC_URL").replace(/\/$/, "");

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Le chiavi contengono un suffisso casuale: ogni nuovo upload ha un URL nuovo.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async delete(keys) {
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
      );
    },
    publicUrl(key) {
      return `${publicBase}/${key}`;
    },
  };
}

let s3Storage: Storage | undefined;

export function storage(): Storage {
  if (process.env.STORAGE_DRIVER === "s3") return (s3Storage ??= createS3Storage());
  return localStorage;
}
