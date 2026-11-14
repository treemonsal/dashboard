// Routen unter /api/fitbit: Status, Verbinden (OAuth mit PKCE), Rückkehr, Abgleich, Trennen, Trainings.
// Alle hinter Cloudflare Access (app.ts prüft jede Anfrage). Es verlässt nie ein Token den Server.
import type { Hono } from "hono";
import { and, asc, desc, eq, gte, lte, lt } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import { isoDate } from "../../shared/schemas";
import { v, type AppEnv } from "../util";
import { pkceChallenge, randomUrlSafe } from "./crypto";
import { credentialInfo, deleteCredentials, saveCredentials, withCredentials, type CredentialInfo } from "./credentials";
import { SCOPES } from "./google";
import { PROVIDER, KIND, disconnectHealth, saveConnection, syncHealth, syncIfStale } from "./sync";
import { HealthError, type HealthEnv } from "./types";

const { healthConnection, healthOauthState, healthWorkouts, syncRuns, settings } = schema;
const SETUP_KEY = "fitbitSetup";
export const SETUP_STEPS = 7;
const STATE_TTL_MS = 10 * 60_000;

export interface FitbitStatus {
  provider: string;
  configured: boolean;
  /** Namen der Secrets, die auf dem Server noch fehlen (nur Namen). */
  missing: string[];
  connected: boolean;
  connectedAt: string | null;
  /** Zugang abgelaufen oder widerrufen: neu verbinden. */
  needsReconnect: boolean;
  lastError: string | null;
  lastRun: { at: string; ok: boolean; message: string | null } | null;
  redirectUri: string;
  /** Nur ob, woher und die letzten 4 Zeichen der ID. */
  credentials: CredentialInfo;
  /** Abgehakte Schritte der Einrichtung (1 bis 7). */
  setup: number[];
  scopes: string[];
}

/** env ist die aufgelöste Umgebung (withCredentials). */
function missingSecrets(env: HealthEnv): string[] {
  const m: string[] = [];
  if (!env.GOOGLE_HEALTH_CLIENT_ID || !env.GOOGLE_HEALTH_CLIENT_SECRET) m.push("Zugangsdaten");
  if ((env.HEALTH_TOKEN_KEY?.length ?? 0) < 32) m.push("HEALTH_TOKEN_KEY");
  return m;
}
const credBody = z.object({ clientId: z.string().trim().min(8).max(300).regex(/^\S+$/), clientSecret: z.string().trim().min(8).max(300).regex(/^\S+$/) });
const setupBody = z.object({ done: z.array(z.number().int().min(1).max(SETUP_STEPS)).max(SETUP_STEPS) });
async function readSetup(db: AppEnv["Variables"]["db"]): Promise<number[]> {
  const row = await db.select().from(settings).where(eq(settings.key, SETUP_KEY)).get();
  try {
    const a = JSON.parse(row?.value ?? "[]");
    return Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n >= 1 && n <= SETUP_STEPS) : [];
  } catch {
    return [];
  }
}
const redirectUriFor = (reqUrl: string) => `${new URL(reqUrl).origin}/api/fitbit/callback`;
const back = (result: string) => new Response(null, { status: 302, headers: { location: `/einstellungen?fitbit=${result}`, "cache-control": "no-store" } });

export function registerHealth(api: Hono<AppEnv>) {
  api.get("/fitbit/status", async (c) => {
    const env = await withCredentials(c.env as HealthEnv, c.var.db);
    const conn = await c.var.db.select().from(healthConnection).where(eq(healthConnection.id, PROVIDER.id)).get();
    const last = await c.var.db.select().from(syncRuns).where(eq(syncRuns.kind, KIND)).orderBy(desc(syncRuns.at)).limit(1).get();
    const out: FitbitStatus = {
      provider: PROVIDER.id,
      configured: PROVIDER.configured(env),
      missing: missingSecrets(env),
      connected: !!conn,
      connectedAt: conn?.connectedAt ?? null,
      needsReconnect: !!conn?.lastError && /neu verbinden/i.test(conn.lastError),
      lastError: conn?.lastError ?? null,
      lastRun: last ? { at: last.at, ok: last.ok, message: last.message } : null,
      redirectUri: redirectUriFor(c.req.url),
      credentials: await credentialInfo(c.env as HealthEnv, c.var.db),
      setup: await readSetup(c.var.db),
      scopes: SCOPES,
    };
    return c.json(out);
  });

  // Start: die Oberfläche holt die Adresse per POST und öffnet sie (so bleibt der Aufruf hinter Access und ohne Link-Vorschau-Nebenwirkung).
  api.post("/fitbit/connect", async (c) => {
    const env = await withCredentials(c.env as HealthEnv, c.var.db);
    if (!PROVIDER.configured(env)) return c.json({ error: "Zugangsdaten fehlen", missing: missingSecrets(env) }, 503);
    const db = c.var.db;
    await db.delete(healthOauthState).where(lt(healthOauthState.createdAt, new Date(Date.now() - STATE_TTL_MS).toISOString()));
    const state = randomUrlSafe(32);
    const verifier = randomUrlSafe(48);
    await db.insert(healthOauthState).values({ state, verifier });
    const url = PROVIDER.authUrl(env, { redirectUri: redirectUriFor(c.req.url), state, challenge: await pkceChallenge(verifier) });
    return c.json({ url });
  });

  api.get("/fitbit/callback", v("query", z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(100).optional() })), async (c) => {
    const env = await withCredentials(c.env as HealthEnv, c.var.db);
    const { code, state, error } = c.req.valid("query");
    const db = c.var.db;
    if (!state) return back("fehler");
    // Einmal verwendbar: Zeile sofort löschen, dann prüfen.
    const row = await db.delete(healthOauthState).where(eq(healthOauthState.state, state)).returning().get();
    if (!row || Date.now() - Date.parse(row.createdAt) > STATE_TTL_MS) return back("fehler");
    if (error || !code) return back("abgelehnt");
    try {
      const tokens = await PROVIDER.exchange(env, { code, verifier: row.verifier, redirectUri: redirectUriFor(c.req.url) }, fetch);
      await saveConnection(db, env, PROVIDER, tokens);
    } catch (e) {
      console.error("Verbinden fehlgeschlagen:", e instanceof HealthError ? e.message : "unbekannt");
      return back("fehler");
    }
    // Erste 30 Tage nachladen; das Ergebnis steht danach in sync_runs.
    const job = syncHealth(c.env as HealthEnv);
    try {
      c.executionCtx.waitUntil(job);
    } catch {
      await job;
    }
    return back("verbunden");
  });

  // Zugangsdaten aus der App: verschlüsselt gespeichert, nie wieder im Klartext ausgegeben (Antwort = Status).
  api.put("/fitbit/credentials", v("json", credBody), async (c) => {
    const raw = c.env as HealthEnv;
    const { clientId, clientSecret } = c.req.valid("json");
    const before = await credentialInfo(raw, c.var.db);
    try {
      await saveCredentials(c.var.db, raw, clientId, clientSecret);
    } catch {
      return c.json({ error: "Speichern nicht möglich (Schlüssel HEALTH_TOKEN_KEY fehlt)" }, 503);
    }
    // Andere Client-ID: die bisherige Verbindung gehört zum alten Client und wäre wertlos.
    if (before.present && before.idTail !== clientId.slice(-4)) await c.var.db.delete(healthConnection).where(eq(healthConnection.id, PROVIDER.id));
    return c.json({ ok: true, credentials: await credentialInfo(raw, c.var.db) });
  });

  api.delete("/fitbit/credentials", async (c) => {
    const ok = await deleteCredentials(c.var.db);
    return c.json({ ok, credentials: await credentialInfo(c.env as HealthEnv, c.var.db) });
  });

  api.put("/fitbit/setup", v("json", setupBody), async (c) => {
    const done = [...new Set(c.req.valid("json").done)].sort((a, b) => a - b);
    await c.var.db.insert(settings).values({ key: SETUP_KEY, value: JSON.stringify(done) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(done), updatedAt: new Date().toISOString() } });
    return c.json({ setup: done });
  });

  api.post("/fitbit/sync", async (c) => {
    const r = await syncHealth(c.env as HealthEnv);
    return c.json(r, r.connected ? 200 : 409);
  });

  // Beim Start der App: gleicht nur ab, wenn der letzte Lauf mindestens 30 Minuten her ist.
  api.post("/fitbit/sync-if-stale", async (c) => c.json(await syncIfStale(c.env as HealthEnv)));

  api.delete("/fitbit/connection", async (c) => c.json({ ok: await disconnectHealth(c.env as HealthEnv) }));

  api.get("/fitbit/workouts", v("query", z.object({ from: isoDate.optional(), to: isoDate.optional() })), async (c) => {
    const { from, to } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(healthWorkouts)
      .where(and(from ? gte(healthWorkouts.day, from) : undefined, to ? lte(healthWorkouts.day, to) : undefined))
      .orderBy(asc(healthWorkouts.startAt));
    return c.json(rows);
  });
}
