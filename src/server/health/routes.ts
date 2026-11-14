// Routen unter /api/fitbit: Status, Verbinden (OAuth mit PKCE), Rückkehr, Abgleich, Trennen, Trainings.
// Alle hinter Cloudflare Access (app.ts prüft jede Anfrage). Es verlässt nie ein Token den Server.
import type { Hono } from "hono";
import { and, asc, desc, eq, gte, lte, lt } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import { isoDate } from "../../shared/schemas";
import { v, type AppEnv } from "../util";
import { pkceChallenge, randomUrlSafe } from "./crypto";
import { PROVIDER, KIND, disconnectHealth, saveConnection, syncHealth } from "./sync";
import { HealthError, type HealthEnv } from "./types";

const { healthConnection, healthOauthState, healthWorkouts, syncRuns } = schema;
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
}

function missingSecrets(env: HealthEnv): string[] {
  const m: string[] = [];
  if (!env.GOOGLE_HEALTH_CLIENT_ID) m.push("GOOGLE_HEALTH_CLIENT_ID");
  if (!env.GOOGLE_HEALTH_CLIENT_SECRET) m.push("GOOGLE_HEALTH_CLIENT_SECRET");
  if ((env.HEALTH_TOKEN_KEY?.length ?? 0) < 32) m.push("HEALTH_TOKEN_KEY");
  return m;
}
const redirectUriFor = (reqUrl: string) => `${new URL(reqUrl).origin}/api/fitbit/callback`;
const back = (result: string) => new Response(null, { status: 302, headers: { location: `/einstellungen?fitbit=${result}`, "cache-control": "no-store" } });

export function registerHealth(api: Hono<AppEnv>) {
  api.get("/fitbit/status", async (c) => {
    const env = c.env as HealthEnv;
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
    };
    return c.json(out);
  });

  // Start: die Oberfläche holt die Adresse per POST und öffnet sie (so bleibt der Aufruf hinter Access und ohne Link-Vorschau-Nebenwirkung).
  api.post("/fitbit/connect", async (c) => {
    const env = c.env as HealthEnv;
    if (!PROVIDER.configured(env)) return c.json({ error: "Zugangsdaten fehlen auf dem Server", missing: missingSecrets(env) }, 503);
    const db = c.var.db;
    await db.delete(healthOauthState).where(lt(healthOauthState.createdAt, new Date(Date.now() - STATE_TTL_MS).toISOString()));
    const state = randomUrlSafe(32);
    const verifier = randomUrlSafe(48);
    await db.insert(healthOauthState).values({ state, verifier });
    const url = PROVIDER.authUrl(env, { redirectUri: redirectUriFor(c.req.url), state, challenge: await pkceChallenge(verifier) });
    return c.json({ url });
  });

  api.get("/fitbit/callback", v("query", z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(100).optional() })), async (c) => {
    const env = c.env as HealthEnv;
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
    const job = syncHealth(env);
    try {
      c.executionCtx.waitUntil(job);
    } catch {
      await job;
    }
    return back("verbunden");
  });

  api.post("/fitbit/sync", async (c) => {
    const r = await syncHealth(c.env as HealthEnv);
    return c.json(r, r.connected ? 200 : 409);
  });

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
