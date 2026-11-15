// Anbieter Google Health API (v4), Nachfolger der Fitbit Web API. Quellen und Entscheidung: docs/fitbit.md.
import { addDays, daysBetween } from "../../shared/dates";
import { mapExercise, mapRestingHr, mapSleep, mapSleepNights, mapSteps, mapWeight, toDays, type Acc } from "./map";
import { shortHash } from "./crypto";
import { HealthError, type FetchResult, type HealthEnv, type HealthProvider, type TokenSet } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_OAUTH = "https://oauth2.googleapis.com";
const DEFAULT_API = "https://health.googleapis.com";
const SCOPE_BASE = "https://www.googleapis.com/auth/googlehealth.";
/** Nur lesen: Schritte und Training, Ruhepuls und Gewicht, Schlaf. */
export const SCOPES = ["activity_and_fitness.readonly", "health_metrics_and_measurements.readonly", "sleep.readonly"].map((s) => SCOPE_BASE + s);

const MAX_PAGES = 40;
const ROLLUP_MAX_DAYS = 90;

const oauth = (env: HealthEnv) => (env.HEALTH_OAUTH_BASE ?? DEFAULT_OAUTH).replace(/\/+$/, "");
const api = (env: HealthEnv) => (env.HEALTH_API_BASE ?? DEFAULT_API).replace(/\/+$/, "");

const dateParts = (d: string) => {
  const [year, month, day] = d.split("-").map(Number);
  return { year, month, day };
};

async function tokenCall(env: HealthEnv, body: Record<string, string>, f: typeof fetch): Promise<TokenSet> {
  let res: Response;
  try {
    res = await f(`${oauth(env)}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: env.GOOGLE_HEALTH_CLIENT_ID ?? "", client_secret: env.GOOGLE_HEALTH_CLIENT_SECRET ?? "", ...body }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HealthError("Google nicht erreichbar", "api");
  }
  let j: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown } = {};
  try {
    j = (await res.json()) as typeof j;
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok || typeof j.access_token !== "string") {
    // Nur den Fehlercode von Google, nie den Inhalt der Anfrage.
    const code = typeof j.error === "string" ? j.error : String(res.status);
    if (code === "invalid_grant") throw new HealthError("Verbindung abgelaufen oder widerrufen. Neu verbinden.", "auth");
    if (code === "invalid_client" || code === "unauthorized_client") throw new HealthError("Client-ID oder Secret werden von Google abgelehnt", "config");
    throw new HealthError(`Anmeldung bei Google fehlgeschlagen (${code.slice(0, 40)})`, "auth");
  }
  const secs = typeof j.expires_in === "number" ? j.expires_in : 3600;
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
    expiresAt: new Date(Date.now() + secs * 1000).toISOString(),
    scope: typeof j.scope === "string" ? j.scope : "",
  };
}

async function call(env: HealthEnv, token: string, f: typeof fetch, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await f(`${api(env)}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HealthError("Google nicht erreichbar", "api");
  }
  if (res.status === 401) throw new HealthError("Zugriff abgelehnt, neu verbinden", "auth");
  if (res.status === 403) throw new HealthError("Keine Berechtigung für diese Daten (Rechte beim Verbinden nicht erteilt oder API nicht aktiviert)", "api");
  if (res.status === 429) throw new HealthError("Zu viele Anfragen, später wieder versuchen", "api");
  if (!res.ok) throw new HealthError(`Fehler bei Google (HTTP ${res.status})`, "api");
  try {
    return await res.json();
  } catch {
    throw new HealthError("Antwort von Google nicht lesbar", "api");
  }
}

type Page = { nextPageToken?: unknown };
/** Holt alle Seiten und hängt die Listen unter `key` zusammen. */
async function allPages(key: string, once: (pageToken?: string) => Promise<unknown>): Promise<unknown> {
  const items: unknown[] = [];
  let token: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = (await once(token)) as Record<string, unknown> & Page;
    if (Array.isArray(r?.[key])) items.push(...(r[key] as unknown[]));
    token = typeof r?.nextPageToken === "string" && r.nextPageToken ? r.nextPageToken : undefined;
    if (!token) break;
  }
  return { [key]: items };
}

export const googleHealth: HealthProvider = {
  id: "google",
  label: "Google Health (Fitbit)",
  configured: (env) => !!env.GOOGLE_HEALTH_CLIENT_ID && !!env.GOOGLE_HEALTH_CLIENT_SECRET && (env.HEALTH_TOKEN_KEY?.length ?? 0) >= 32,

  authUrl(env, p) {
    const q = new URLSearchParams({
      client_id: env.GOOGLE_HEALTH_CLIENT_ID ?? "",
      redirect_uri: p.redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      state: p.state,
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      // offline + consent: nur so gibt Google (wieder) einen Refresh-Token aus.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
    });
    return `${AUTH_URL}?${q}`;
  },

  exchange: (env, p, f) => tokenCall(env, { grant_type: "authorization_code", code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri }, f),
  refresh: (env, rt, f) => tokenCall(env, { grant_type: "refresh_token", refresh_token: rt }, f),

  async revoke(env, token, f) {
    try {
      const r = await f(`${oauth(env)}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      });
      await r.body?.cancel();
    } catch {
      /* Trennen darf nicht daran scheitern */
    }
  },

  async fetchRange(env, token, from, toExclusive, f): Promise<FetchResult> {
    const acc: Acc = new Map();
    const problems: string[] = [];
    const me = "/v4/users/me/dataTypes";
    const rangeFilter = (field: string) => `${field} >= "${from}" AND ${field} < "${toExclusive}"`;
    const run = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        // Ungültiger Zugang bricht alles ab; sonst nur diese Messgrösse melden.
        if (e instanceof HealthError && e.kind === "auth") throw e;
        problems.push(`${label}: ${e instanceof HealthError ? e.message : "unerwarteter Fehler"}`);
      }
    };
    const listAll = (type: string, filter: string, pageSize?: number) =>
      allPages("dataPoints", (pt) => {
        const q = new URLSearchParams({ filter });
        if (pageSize) q.set("pageSize", String(pageSize));
        if (pt) q.set("pageToken", pt);
        return call(env, token, f, `${me}/${type}/dataPoints?${q}`);
      });

    await run("Schritte", async () => {
      // dailyRollUp erlaubt höchstens 90 Tage pro Anfrage.
      for (let s = from; s < toExclusive; s = addDays(s, ROLLUP_MAX_DAYS)) {
        const e = daysBetween(s, toExclusive) > ROLLUP_MAX_DAYS ? addDays(s, ROLLUP_MAX_DAYS) : toExclusive;
        const res = await allPages("rollupDataPoints", (pt) =>
          call(env, token, f, `${me}/steps/dataPoints:dailyRollUp`, {
            method: "POST",
            body: { range: { start: { date: dateParts(s) }, end: { date: dateParts(e) } }, windowSizeDays: 1, ...(pt ? { pageToken: pt } : {}) },
          }),
        );
        mapSteps(res, acc);
      }
    });
    await run("Ruhepuls", async () => mapRestingHr(await listAll("daily-resting-heart-rate", rangeFilter("daily_resting_heart_rate.date")), acc));
    await run("Gewicht", async () => mapWeight(await listAll("weight", rangeFilter("weight.sample_time.civil_time")), acc));
    // Schlaf zählt zum Tag des Aufwachens: gefiltert wird nach dem Ende der Schlafphase. Seitengrösse bei Schlaf und Training höchstens 25.
    let nights: FetchResult["nights"] = [];
    await run("Schlaf", async () => {
      const res = await listAll("sleep", rangeFilter("sleep.interval.civil_end_time"), 25);
      mapSleep(res, acc);
      nights = mapSleepNights(res);
    });

    const workouts: FetchResult["workouts"] = [];
    await run("Training", async () => {
      const res = await listAll("exercise", rangeFilter("exercise.interval.civil_start_time"), 25);
      for (const w of mapExercise(res, (start) => start)) workouts.push({ ...w, id: `google:${await shortHash(w.startAt)}` });
    });
    return { days: toDays(acc), workouts, nights, problems };
  },
};
