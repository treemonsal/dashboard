// Zugangsdaten (OAuth-Client) auflösen: zuerst die in der App eingetragenen (verschlüsselt in D1), sonst die Worker-Secrets.
// Klartext von ID und Secret gibt es nur im Speicher, nie in Antworten, Logs oder Fehlermeldungen.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { nowIso, type Db } from "../util";
import { decryptToken, encryptToken } from "./crypto";
import type { HealthEnv } from "./types";

const { healthCredentials } = schema;
export const CRED_ID = "google";

export interface Credentials {
  clientId: string;
  clientSecret: string;
  source: "app" | "secret";
}
export interface CredentialInfo {
  present: boolean;
  source: "app" | "secret" | null;
  /** Letzte 4 Zeichen der Client-ID, sonst nichts. */
  idTail: string | null;
}

const tail = (id: string) => id.slice(-4);

export async function saveCredentials(db: Db, env: HealthEnv, clientId: string, clientSecret: string): Promise<void> {
  const row = {
    id: CRED_ID,
    clientIdEnc: await encryptToken(clientId, env.HEALTH_TOKEN_KEY),
    clientSecretEnc: await encryptToken(clientSecret, env.HEALTH_TOKEN_KEY),
    idTail: tail(clientId),
    updatedAt: nowIso(),
  };
  await db.insert(healthCredentials).values(row).onConflictDoUpdate({ target: healthCredentials.id, set: row });
}

export async function deleteCredentials(db: Db): Promise<boolean> {
  const r = await db.delete(healthCredentials).where(eq(healthCredentials.id, CRED_ID)).returning({ id: healthCredentials.id });
  return r.length > 0;
}

/** Wirksame Zugangsdaten oder null. Ist die gespeicherte Zeile nicht lesbar (Schlüssel geändert), gilt der Rückfall auf die Secrets. */
export async function resolveCredentials(env: HealthEnv, db: Db = drizzle(env.DB, { schema })): Promise<Credentials | null> {
  const row = await db.select().from(healthCredentials).where(eq(healthCredentials.id, CRED_ID)).get();
  if (row) {
    try {
      return { clientId: await decryptToken(row.clientIdEnc, env.HEALTH_TOKEN_KEY), clientSecret: await decryptToken(row.clientSecretEnc, env.HEALTH_TOKEN_KEY), source: "app" };
    } catch {
      /* unlesbar: Rückfall */
    }
  }
  if (env.GOOGLE_HEALTH_CLIENT_ID && env.GOOGLE_HEALTH_CLIENT_SECRET) return { clientId: env.GOOGLE_HEALTH_CLIENT_ID, clientSecret: env.GOOGLE_HEALTH_CLIENT_SECRET, source: "secret" };
  return null;
}

/** Kopie der Umgebung mit den wirksamen Zugangsdaten; der Anbieter (google.ts) liest sie aus diesen Feldern. */
export async function withCredentials(env: HealthEnv, db?: Db): Promise<HealthEnv> {
  const c = await resolveCredentials(env, db);
  return { ...env, GOOGLE_HEALTH_CLIENT_ID: c?.clientId, GOOGLE_HEALTH_CLIENT_SECRET: c?.clientSecret };
}

export async function credentialInfo(env: HealthEnv, db: Db): Promise<CredentialInfo> {
  const row = await db.select({ idTail: healthCredentials.idTail }).from(healthCredentials).where(eq(healthCredentials.id, CRED_ID)).get();
  const c = await resolveCredentials(env, db);
  if (!c) return { present: false, source: null, idTail: null };
  return { present: true, source: c.source, idTail: c.source === "app" ? (row?.idTail ?? tail(c.clientId)) : tail(c.clientId) };
}
