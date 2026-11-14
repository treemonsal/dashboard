import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../src/server/db/schema";
import { decryptToken, encryptToken, pkceChallenge } from "../../src/server/health/crypto";
import { PROVIDER, disconnectHealth, dueNow, saveConnection, syncHealth } from "../../src/server/health/sync";
import type { HealthEnv } from "../../src/server/health/types";
import { fakeGoogle, j } from "./fake";

const e = env as unknown as HealthEnv;
const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-11-14T08:30:00Z"); // 09:30 in Zürich

async function reset() {
  for (const t of ["health_connection", "health_oauth_state", "health_workouts", "health_daily", "sync_runs"]) await env.DB.exec(`DELETE FROM ${t}`);
}
async function connect(expiresInMs = 3_600_000) {
  await saveConnection(db, e, PROVIDER, { accessToken: "access-0", refreshToken: "refresh-geheim-1", expiresAt: new Date(NOW.getTime() + expiresInMs).toISOString(), scope: "x" });
}
const runs = () => db.select().from(schema.syncRuns).all();
const conn = () => db.select().from(schema.healthConnection).get();

beforeEach(reset);
afterEach(() => vi.restoreAllMocks());

describe("Verschlüsselung", () => {
  it("Roundtrip, immer neue Zufallszahl, falscher Schlüssel schlägt fehl", async () => {
    const k = "k".repeat(40);
    const a = await encryptToken("geheim", k), b = await encryptToken("geheim", k);
    expect(a).not.toBe(b);
    expect(a).not.toContain("geheim");
    expect(await decryptToken(a, k)).toBe("geheim");
    await expect(decryptToken(a, "x".repeat(40))).rejects.toThrow(/Neu verbinden/);
    await expect(encryptToken("a", "kurz")).rejects.toThrow(/Schlüssel/);
    await expect(decryptToken("müll", k)).rejects.toThrow();
  });
  it("PKCE-Challenge entspricht dem RFC-7636-Beispiel", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("Abgleich", () => {
  it("schreibt Tage und Trainings, merkt sich den Lauf, Tokens liegen nur verschlüsselt", async () => {
    await connect();
    const g = fakeGoogle();
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r).toMatchObject({ ok: true, connected: true, workouts: 2 });
    const days = await db.select().from(schema.healthDaily).all();
    const d13 = days.find((d) => d.day === "2026-11-13")!;
    expect(d13).toMatchObject({ steps: 10032, restingHr: 58, sleepMin: 441, source: "fitbit" });
    expect(days.find((d) => d.day === "2026-11-12")).toMatchObject({ steps: 8421, restingHr: 61, weightKg: 68.9 });
    expect((await db.select().from(schema.healthWorkouts).all()).map((w) => w.day).sort()).toEqual(["2026-11-12", "2026-11-13"]);
    const [run] = await runs();
    expect(run).toMatchObject({ kind: "fitbit", ok: true });
    const c = (await conn())!;
    expect(c.refreshEnc.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(c)).not.toContain("refresh-geheim-1");
    expect(JSON.stringify(c)).not.toContain("access-0");
    // Kein Token in der Meldung des Laufs
    expect(run.message).not.toMatch(/refresh|access|geheim/i);
  });

  it("erster Abgleich lädt 30 Tage nach, danach 3; zweiter Lauf ist idempotent", async () => {
    await connect();
    const g = fakeGoogle();
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    const first = g.calls.find((c) => c.url.pathname.includes("daily-resting-heart-rate"))!;
    expect(first.url.searchParams.get("filter")).toBe('daily_resting_heart_rate.date >= "2026-10-16" AND daily_resting_heart_rate.date < "2026-11-15"');
    const roll = g.calls.find((c) => c.url.pathname.includes(":dailyRollUp"))!;
    expect(JSON.parse(roll.body)).toMatchObject({ windowSizeDays: 1, range: { start: { date: { year: 2026, month: 10, day: 16 } }, end: { date: { year: 2026, month: 11, day: 15 } } } });
    const sleepCall = g.calls.find((c) => c.url.pathname.includes("/sleep/"))!;
    expect(sleepCall.url.searchParams.get("filter")).toContain("sleep.interval.civil_end_time >=");
    expect(sleepCall.url.searchParams.get("pageSize")).toBe("25");

    const g2 = fakeGoogle();
    await syncHealth(e, { fetcher: g2.fetcher, now: NOW });
    expect(g2.calls.find((c) => c.url.pathname.includes("/weight/"))!.url.searchParams.get("filter")).toBe('weight.sample_time.civil_time >= "2026-11-12" AND weight.sample_time.civil_time < "2026-11-15"');
    expect((await db.select().from(schema.healthDaily).all()).length).toBe(3);
    expect((await db.select().from(schema.healthWorkouts).all()).length).toBe(2);
    expect(await runs()).toHaveLength(2);
  });

  it("von Hand eingetragene Werte bleiben, wenn die Antwort sie nicht enthält", async () => {
    await connect();
    await db.insert(schema.healthDaily).values({ day: "2026-11-13", weightKg: 70.5, source: "manual" });
    await syncHealth(e, { fetcher: fakeGoogle().fetcher, now: NOW });
    expect(await db.select().from(schema.healthDaily).where(eq(schema.healthDaily.day, "2026-11-13")).get()).toMatchObject({ weightKg: 70.5, steps: 10032, source: "fitbit" });
  });

  it("blättert durch mehrere Seiten", async () => {
    await connect();
    const g = fakeGoogle({
      override: {
        "daily-resting-heart-rate": (n) =>
          n === 1
            ? j({ dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "55", date: { year: 2026, month: 11, day: 10 } } }], nextPageToken: "seite2" })
            : j({ dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "56", date: { year: 2026, month: 11, day: 11 } } }] }),
      },
    });
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    const pages = g.calls.filter((c) => c.url.pathname.includes("daily-resting-heart-rate"));
    expect(pages).toHaveLength(2);
    expect(pages[1].url.searchParams.get("pageToken")).toBe("seite2");
    const hr = await db.select().from(schema.healthDaily).all();
    expect(hr.find((d) => d.day === "2026-11-10")?.restingHr).toBe(55);
    expect(hr.find((d) => d.day === "2026-11-11")?.restingHr).toBe(56);
  });
});

describe("Token-Erneuerung", () => {
  it("erneuert einen abgelaufenen Zugriffstoken mit dem Refresh-Token und speichert den neuen verschlüsselt", async () => {
    await connect(10_000); // läuft in 10 s ab: innerhalb der Reserve
    const g = fakeGoogle();
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r.ok).toBe(true);
    expect(g.refreshes).toBe(1);
    const tokenCall = g.calls.find((c) => c.url.pathname === "/token")!;
    expect(tokenCall.form?.get("refresh_token")).toBe("refresh-geheim-1");
    expect(g.calls.filter((c) => c.url.pathname !== "/token").every((c) => c.auth === "Bearer access-2")).toBe(true);
    const c = (await conn())!;
    expect(await decryptToken(c.accessEnc!, e.HEALTH_TOKEN_KEY)).toBe("access-2");
    expect(await decryptToken(c.refreshEnc, e.HEALTH_TOKEN_KEY)).toBe("refresh-geheim-1");
  });

  it("gültiger Zugriffstoken wird wiederverwendet, ohne Erneuerung", async () => {
    await connect();
    const g = fakeGoogle();
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(g.refreshes).toBe(0);
    expect(g.calls.find((c) => c.url.pathname !== "/token")!.auth).toBe("Bearer access-0");
  });

  it("401 mitten im Abgleich: einmal erneuern, dann nochmals versuchen", async () => {
    await connect();
    const g = fakeGoogle({ valid: (t) => t !== "access-0" });
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r.ok).toBe(true);
    expect(g.refreshes).toBe(1);
  });

  it("neuer Refresh-Token von Google wird übernommen", async () => {
    await connect(0);
    const g = fakeGoogle({ refresh: () => j({ access_token: "access-9", refresh_token: "refresh-neu", expires_in: 3600 }) });
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(await decryptToken((await conn())!.refreshEnc, e.HEALTH_TOKEN_KEY)).toBe("refresh-neu");
  });
});

describe("Fehlerfälle", () => {
  it("nicht verbunden: ehrliche Meldung, kein Lauf geschrieben", async () => {
    const r = await syncHealth(e, { fetcher: fakeGoogle().fetcher, now: NOW });
    expect(r).toMatchObject({ ok: false, connected: false, message: "Nicht verbunden" });
    expect(await runs()).toHaveLength(0);
  });
  it("Zugang widerrufen (invalid_grant): Meldung 'Neu verbinden', Verbindung bleibt, Lauf als Fehler", async () => {
    await connect(0);
    const g = fakeGoogle({ refresh: () => j({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) });
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Neu verbinden/);
    expect((await conn())!.lastError).toMatch(/Neu verbinden/);
    const [run] = await runs();
    expect(run.ok).toBe(false);
    expect(JSON.stringify(run)).not.toContain("refresh-geheim-1");
  });
  it("eine Messgrösse nicht lesbar (403): übrige werden geschrieben, Fehler benennt sie", async () => {
    await connect();
    const g = fakeGoogle({ override: { weight: () => j({ error: { code: 403 } }, 403) } });
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Gewicht: Keine Berechtigung/);
    const days = await db.select().from(schema.healthDaily).all();
    expect(days.find((d) => d.day === "2026-11-13")?.steps).toBe(10032);
    expect(days.every((d) => d.weightKg === null)).toBe(true);
    expect((await runs())[0].ok).toBe(false);
  });
  it("Serverfehler 500 und Ratenlimit 429 werden als Text gemeldet", async () => {
    await connect();
    const g = fakeGoogle({ override: { sleep: () => j({}, 500), exercise: () => j({}, 429) } });
    const r = await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(r.message).toMatch(/Schlaf: Fehler bei Google \(HTTP 500\)/);
    expect(r.message).toMatch(/Training: Zu viele Anfragen/);
  });
  it("Netzwerkfehler: keine Ausnahme nach aussen", async () => {
    await connect();
    const r = await syncHealth(e, { fetcher: (async () => { throw new TypeError("boom"); }) as typeof fetch, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nicht erreichbar/);
  });
  it("Secrets fehlen auf dem Server: klare Meldung statt Absturz", async () => {
    await connect();
    const bare = { DB: env.DB } as HealthEnv;
    const r = await syncHealth(bare, { fetcher: fakeGoogle().fetcher, now: NOW });
    expect(r).toMatchObject({ ok: false, connected: true });
    expect(r.message).toMatch(/Zugangsdaten/);
  });
  it("kein Token in Logs", async () => {
    await connect(0);
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const g = fakeGoogle({ refresh: () => j({ error: "invalid_grant" }, 400), override: { weight: () => { throw new Error("access-0 refresh-geheim-1"); } } });
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    await connect();
    await syncHealth(e, { fetcher: fakeGoogle({ override: { weight: () => { throw new Error("refresh-geheim-1"); } } }).fetcher, now: NOW });
    const out = spies.flatMap((s) => s.mock.calls).map((c) => c.join(" ")).join("\n");
    expect(out).not.toMatch(/refresh-geheim|access-\d|test-client-secret/);
    const msgs = (await runs()).map((r) => r.message).join("\n");
    expect(msgs).not.toMatch(/refresh-geheim|access-\d|test-client-secret/);
  });
});

describe("Trennen", () => {
  it("widerruft bei Google, löscht alle Tokens, Messwerte bleiben", async () => {
    await connect();
    const g = fakeGoogle();
    await syncHealth(e, { fetcher: g.fetcher, now: NOW });
    expect(await disconnectHealth(e, { fetcher: g.fetcher })).toBe(true);
    const rev = g.calls.find((c) => c.url.pathname === "/revoke")!;
    expect(rev.form?.get("token")).toBe("refresh-geheim-1");
    expect(await conn()).toBeUndefined();
    expect((await db.select().from(schema.healthDaily).all()).length).toBeGreaterThan(0);
    expect(await disconnectHealth(e, { fetcher: g.fetcher })).toBe(false);
  });
  it("auch wenn Google nicht erreichbar ist", async () => {
    await connect();
    expect(await disconnectHealth(e, { fetcher: (async () => { throw new Error("x"); }) as typeof fetch })).toBe(true);
    expect(await conn()).toBeUndefined();
  });
});

describe("Zeitpunkt für den Cron", () => {
  const at = (iso: string) => new Date(iso);
  it("nicht verbunden: nie", async () => expect(await dueNow(e, at("2026-11-14T09:00:00Z"))).toBe(false));
  it("vor 08:00 Zürich nicht, danach einmal pro Tag", async () => {
    await connect();
    expect(await dueNow(e, at("2026-11-14T06:30:00Z"))).toBe(false); // 07:30
    expect(await dueNow(e, at("2026-11-14T07:00:00Z"))).toBe(true); // 08:00
    await db.insert(schema.syncRuns).values({ id: "r1", kind: "fitbit", ok: true, at: "2026-11-14T07:05:00.000Z" });
    expect(await dueNow(e, at("2026-11-14T15:00:00Z"))).toBe(false);
    expect(await dueNow(e, at("2026-11-15T07:00:00Z"))).toBe(true);
  });
  it("nach einem Fehler nach etwa einer Stunde wieder", async () => {
    await connect();
    await db.insert(schema.syncRuns).values({ id: "r2", kind: "fitbit", ok: false, at: "2026-11-14T07:05:00.000Z" });
    expect(await dueNow(e, at("2026-11-14T07:40:00Z"))).toBe(false);
    expect(await dueNow(e, at("2026-11-14T08:06:00Z"))).toBe(true);
  });
});
