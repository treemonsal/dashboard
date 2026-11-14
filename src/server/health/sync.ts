// Abgleich mit dem Anbieter: Token bereithalten, Zeitraum lesen, in health_daily und health_workouts schreiben, sync_runs festhalten.
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { addDays, todayInZone } from "../../shared/dates";
import { newId, nowIso, type Db } from "../util";
import { decryptToken, encryptToken } from "./crypto";
import { googleHealth } from "./google";
import { withCredentials } from "./credentials";
import { HealthError, type DayValues, type HealthEnv, type HealthProvider, type TokenSet, type Workout } from "./types";

export const PROVIDER = googleHealth;
export const KIND = "fitbit";
export const FIRST_DAYS = 30;
/** Tage, die ein regelmässiger Abgleich liest (Cron und Öffnen der App). */
export const NIGHTLY_DAYS = 2;
/** Abstand zwischen zwei Abgleichen: stündlich; nach einem Fehler und beim Öffnen frühestens nach 30 Minuten. */
export const REGULAR_MIN = 55;
export const RETRY_MIN = 30;
/** Cron: stündlich ab dieser Zürcher Stunde bis 23:59. */
export const FIRST_HOUR = 6;
const SLACK_MS = 60_000;
const BATCH = 40;

const { healthConnection, healthDaily, healthWorkouts, syncRuns } = schema;

export interface HealthSyncDeps {
  fetcher?: typeof fetch;
  now?: Date;
  provider?: HealthProvider;
  /** Anzahl Tage; sonst 30 beim ersten Mal, danach 3. */
  days?: number;
}
export interface HealthSyncResult {
  ok: boolean;
  message: string;
  days: number;
  workouts: number;
  connected: boolean;
}

const short = (s: string) => s.slice(0, 500);

async function storeTokens(db: Db, env: HealthEnv, provider: HealthProvider, t: TokenSet): Promise<void> {
  const set: Partial<typeof healthConnection.$inferInsert> = {
    accessEnc: await encryptToken(t.accessToken, env.HEALTH_TOKEN_KEY),
    accessExpiresAt: t.expiresAt,
    updatedAt: nowIso(),
    lastError: null,
  };
  if (t.scope) set.scope = t.scope;
  if (t.refreshToken) set.refreshEnc = await encryptToken(t.refreshToken, env.HEALTH_TOKEN_KEY);
  await db.update(healthConnection).set(set).where(eq(healthConnection.id, provider.id));
}

/** Speichert die Verbindung nach dem ersten Austausch (Refresh-Token zwingend). */
export async function saveConnection(db: Db, env: HealthEnv, provider: HealthProvider, t: TokenSet): Promise<void> {
  if (!t.refreshToken) throw new HealthError("Google hat keinen dauerhaften Zugang ausgegeben. Zugriff in den Google-Kontoeinstellungen entfernen und neu verbinden.", "auth");
  const row = {
    id: provider.id,
    refreshEnc: await encryptToken(t.refreshToken, env.HEALTH_TOKEN_KEY),
    accessEnc: await encryptToken(t.accessToken, env.HEALTH_TOKEN_KEY),
    accessExpiresAt: t.expiresAt,
    scope: t.scope,
    connectedAt: nowIso(),
    lastError: null,
    updatedAt: nowIso(),
  };
  await db.insert(healthConnection).values(row).onConflictDoUpdate({ target: healthConnection.id, set: row });
}

async function freshAccess(db: Db, env: HealthEnv, provider: HealthProvider, f: typeof fetch, now: Date, force: boolean): Promise<string> {
  const conn = await db.select().from(healthConnection).where(eq(healthConnection.id, provider.id)).get();
  if (!conn) throw new HealthError("Nicht verbunden", "auth");
  if (!force && conn.accessEnc && conn.accessExpiresAt && Date.parse(conn.accessExpiresAt) - now.getTime() > SLACK_MS) {
    return decryptToken(conn.accessEnc, env.HEALTH_TOKEN_KEY);
  }
  const refreshed = await provider.refresh(env, await decryptToken(conn.refreshEnc, env.HEALTH_TOKEN_KEY), f);
  await storeTokens(db, env, provider, refreshed);
  return refreshed.accessToken;
}

async function write(db: Db, days: DayValues[], workouts: Workout[]): Promise<void> {
  const stmts: unknown[] = [];
  for (const d of days) {
    if (d.sleepMin === null && d.steps === null && d.restingHr === null && d.weightKg === null) continue;
    stmts.push(
      db
        .insert(healthDaily)
        .values({ day: d.day, sleepMin: d.sleepMin, steps: d.steps, restingHr: d.restingHr, weightKg: d.weightKg, source: "fitbit" })
        .onConflictDoUpdate({
          target: healthDaily.day,
          // Fehlt ein Wert in der Antwort, bleibt der vorhandene (auch ein von Hand eingetragener) stehen.
          set: {
            sleepMin: sql`coalesce(excluded.sleep_min, ${healthDaily.sleepMin})`,
            steps: sql`coalesce(excluded.steps, ${healthDaily.steps})`,
            restingHr: sql`coalesce(excluded.resting_hr, ${healthDaily.restingHr})`,
            weightKg: sql`coalesce(excluded.weight_kg, ${healthDaily.weightKg})`,
            source: "fitbit",
            updatedAt: nowIso(),
          },
        }),
    );
  }
  for (const w of workouts) {
    const v = { ...w, source: "fitbit" };
    stmts.push(db.insert(healthWorkouts).values(v).onConflictDoUpdate({ target: healthWorkouts.id, set: { ...v, updatedAt: nowIso() } }));
  }
  for (let i = 0; i < stmts.length; i += BATCH) await db.batch(stmts.slice(i, i + BATCH) as never);
}

async function record(db: Db, ok: boolean, message: string): Promise<void> {
  await db.insert(syncRuns).values({ id: newId(), kind: KIND, ok, message: short(message) });
}

export async function syncHealth(rawEnv: HealthEnv, deps: HealthSyncDeps = {}): Promise<HealthSyncResult> {
  const provider = deps.provider ?? PROVIDER;
  const f = deps.fetcher ?? fetch;
  const now = deps.now ?? new Date();
  const db: Db = drizzle(rawEnv.DB, { schema });
  const env = await withCredentials(rawEnv, db);

  const conn = await db.select({ id: healthConnection.id }).from(healthConnection).where(eq(healthConnection.id, provider.id)).get();
  if (!conn) return { ok: false, message: "Nicht verbunden", days: 0, workouts: 0, connected: false };
  const fail = async (message: string): Promise<HealthSyncResult> => {
    await db.update(healthConnection).set({ lastError: short(message), updatedAt: nowIso() }).where(eq(healthConnection.id, provider.id));
    await record(db, false, message);
    return { ok: false, message, days: 0, workouts: 0, connected: true };
  };
  if (!provider.configured(env)) return fail("Zugangsdaten sind auf dem Server nicht eingetragen");

  try {
    const everOk = await db.select({ id: syncRuns.id }).from(syncRuns).where(and(eq(syncRuns.kind, KIND), eq(syncRuns.ok, true))).limit(1).get();
    const n = deps.days ?? (everOk ? NIGHTLY_DAYS : FIRST_DAYS);
    const today = todayInZone(now);
    const from = addDays(today, -(n - 1));
    const to = addDays(today, 1);

    let token = await freshAccess(db, env, provider, f, now, false);
    let res;
    try {
      res = await provider.fetchRange(env, token, from, to, f);
    } catch (e) {
      // Zugriffstoken früher ungültig geworden: einmal erneuern, dann nochmals.
      if (!(e instanceof HealthError) || e.kind !== "auth") throw e;
      token = await freshAccess(db, env, provider, f, now, true);
      res = await provider.fetchRange(env, token, from, to, f);
    }
    await write(db, res.days, res.workouts);
    const ok = res.problems.length === 0;
    const written = res.days.length;
    const base = `${written} ${written === 1 ? "Tag" : "Tage"}, ${res.workouts.length} ${res.workouts.length === 1 ? "Training" : "Trainings"}`;
    const message = ok ? base : `${base}. ${res.problems.join("; ")}`;
    await db.update(healthConnection).set({ lastError: ok ? null : short(message), updatedAt: nowIso() }).where(eq(healthConnection.id, provider.id));
    await record(db, ok, message);
    return { ok, message, days: written, workouts: res.workouts.length, connected: true };
  } catch (e) {
    const message = e instanceof HealthError ? e.message : "Unerwarteter Fehler beim Abgleich";
    if (!(e instanceof HealthError)) console.error("Gesundheits-Abgleich fehlgeschlagen:", (e as Error)?.name ?? "unbekannt");
    return fail(message);
  }
}

/** Trennt: Zugang bei Google widerrufen (best effort) und alle gespeicherten Tokens löschen. Messwerte bleiben. */
export async function disconnectHealth(rawEnv: HealthEnv, deps: { fetcher?: typeof fetch; provider?: HealthProvider } = {}): Promise<boolean> {
  const provider = deps.provider ?? PROVIDER;
  const db: Db = drizzle(rawEnv.DB, { schema });
  const env = await withCredentials(rawEnv, db);
  const conn = await db.select().from(healthConnection).where(eq(healthConnection.id, provider.id)).get();
  if (!conn) return false;
  try {
    await provider.revoke(env, await decryptToken(conn.refreshEnc, env.HEALTH_TOKEN_KEY), deps.fetcher ?? fetch);
  } catch {
    /* Token nicht lesbar oder Google nicht erreichbar: trotzdem lokal löschen */
  }
  await db.delete(healthConnection).where(eq(healthConnection.id, provider.id));
  return true;
}

/**
 * Soll der Cron jetzt abgleichen? Stündlich von 06:00 bis 23:59 Zürcher Zeit (Cron läuft alle 5 Minuten, daher 55 Minuten Abstand).
 * Nach einem Fehler frühestens nach 30 Minuten wieder. Google erlaubt 300 Anfragen pro Minute und Nutzer
 * (https://developers.google.com/health/rate-limits); ein Abgleich braucht rund zehn, also etwa 180 pro Tag.
 */
export async function dueNow(env: HealthEnv, now: Date = new Date()): Promise<boolean> {
  const db: Db = drizzle(env.DB, { schema });
  const conn = await db.select({ id: healthConnection.id }).from(healthConnection).where(eq(healthConnection.id, PROVIDER.id)).get();
  if (!conn) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < FIRST_HOUR) return false;
  const last = await db.select().from(syncRuns).where(eq(syncRuns.kind, KIND)).orderBy(desc(syncRuns.at)).limit(1).get();
  if (!last) return true;
  return now.getTime() - Date.parse(last.at) >= (last.ok ? REGULAR_MIN : RETRY_MIN) * 60_000;
}

/** Beim Öffnen der App: abgleichen, wenn der letzte Lauf (auch ein fehlgeschlagener) mindestens 30 Minuten her ist. */
export async function staleNow(env: HealthEnv, now: Date = new Date()): Promise<boolean> {
  const db: Db = drizzle(env.DB, { schema });
  const conn = await db.select({ id: healthConnection.id }).from(healthConnection).where(eq(healthConnection.id, PROVIDER.id)).get();
  if (!conn) return false;
  const last = await db.select().from(syncRuns).where(eq(syncRuns.kind, KIND)).orderBy(desc(syncRuns.at)).limit(1).get();
  return !last || now.getTime() - Date.parse(last.at) >= RETRY_MIN * 60_000;
}

export async function runHealthIfDue(env: HealthEnv, now: Date = new Date()): Promise<void> {
  if (await dueNow(env, now)) await syncHealth(env, { now });
}

export async function syncIfStale(env: HealthEnv, now: Date = new Date()): Promise<{ ran: boolean; ok?: boolean }> {
  if (!(await staleNow(env, now))) return { ran: false };
  const r = await syncHealth(env, { now });
  return { ran: true, ok: r.ok };
}
