import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { fakeGoogle } from "./fake";

const call = (path: string, method = "GET", body?: unknown) =>
  exports.default.fetch("http://localhost" + path, { method, redirect: "manual", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });

async function reset() {
  for (const t of ["health_connection", "health_oauth_state", "health_workouts", "health_daily", "sync_runs"]) await env.DB.exec(`DELETE FROM ${t}`);
}
beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

async function start() {
  const r = await call("/api/fitbit/connect", "POST", {});
  expect(r.status).toBe(200);
  return new URL(((await r.json()) as { url: string }).url);
}

describe("Verbinden", () => {
  it("Status ohne Verbindung: konfiguriert, nicht verbunden, keine Geheimnisse", async () => {
    const r = await call("/api/fitbit/status");
    const txt = await r.text();
    expect(JSON.parse(txt)).toMatchObject({ configured: true, connected: false, missing: [], redirectUri: "http://localhost/api/fitbit/callback", lastRun: null });
    expect(txt).not.toMatch(/test-client-secret|test-token-key/);
  });

  it("Start: Authorization Code mit PKCE (S256), state, offline, nur Leserechte, Secret nicht in der Adresse", async () => {
    const u = await start();
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = u.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("test-client-id.apps.example");
    expect(q.get("redirect_uri")).toBe("http://localhost/api/fitbit/callback");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("state")!.length).toBeGreaterThanOrEqual(40);
    const scopes = q.get("scope")!.split(" ");
    expect(scopes).toHaveLength(3);
    expect(scopes.every((s) => s.startsWith("https://www.googleapis.com/auth/googlehealth.") && s.endsWith(".readonly"))).toBe(true);
    expect(u.toString()).not.toContain("test-client-secret");
  });

  it("Rückkehr mit richtigem state: Tokens getauscht (mit Verifier und Secret), gespeichert, 30 Tage werden geladen", async () => {
    const q = (await start()).searchParams;
    const g = fakeGoogle();
    vi.stubGlobal("fetch", g.fetcher);
    const r = await call(`/api/fitbit/callback?code=gueltiger-code&state=${q.get("state")}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/einstellungen?fitbit=verbunden");
    const ex = g.calls.find((c) => c.url.pathname === "/token")!;
    expect(ex.form?.get("grant_type")).toBe("authorization_code");
    expect(ex.form?.get("code_verifier")).toBeTruthy();
    expect(ex.form?.get("client_secret")).toBe("test-client-secret-0000");
    expect(ex.form?.get("redirect_uri")).toBe("http://localhost/api/fitbit/callback");
    // PKCE: Challenge in der Startadresse gehört zum Verifier
    const { pkceChallenge } = await import("../../src/server/health/crypto");
    expect(await pkceChallenge(ex.form!.get("code_verifier")!)).toBe(q.get("code_challenge"));
    // Nachladen läuft im Hintergrund (waitUntil); kurz warten
    for (let i = 0; i < 50 && !(await env.DB.prepare("select 1 from sync_runs").first()); i++) await new Promise((x) => setTimeout(x, 50));
    const s = await (await call("/api/fitbit/status")).text();
    expect(JSON.parse(s)).toMatchObject({ connected: true, needsReconnect: false, lastRun: { ok: true } });
    expect(s).not.toMatch(/access-1|refresh-geheim/);
    const row = await env.DB.prepare("select refresh_enc, access_enc from health_connection").first<{ refresh_enc: string; access_enc: string }>();
    expect(row!.refresh_enc).not.toContain("refresh-geheim-1");
    expect((await env.DB.prepare("select count(*) n from health_daily").first<{ n: number }>())!.n).toBeGreaterThan(0);
  });

  it("state ist einmal verwendbar und muss stimmen", async () => {
    const q = (await start()).searchParams;
    const g = fakeGoogle();
    vi.stubGlobal("fetch", g.fetcher);
    const bad = await call("/api/fitbit/callback?code=gueltiger-code&state=erfunden");
    expect(bad.headers.get("location")).toBe("/einstellungen?fitbit=fehler");
    const noState = await call("/api/fitbit/callback?code=gueltiger-code");
    expect(noState.headers.get("location")).toBe("/einstellungen?fitbit=fehler");
    expect(g.calls).toHaveLength(0); // ohne gültigen state wird nie ein Code getauscht
    const ok = await call(`/api/fitbit/callback?code=gueltiger-code&state=${q.get("state")}`);
    expect(ok.headers.get("location")).toBe("/einstellungen?fitbit=verbunden");
    const again = await call(`/api/fitbit/callback?code=gueltiger-code&state=${q.get("state")}`);
    expect(again.headers.get("location")).toBe("/einstellungen?fitbit=fehler");
  });

  it("abgelehnte Freigabe und abgelaufener state", async () => {
    const q = (await start()).searchParams;
    const denied = await call(`/api/fitbit/callback?error=access_denied&state=${q.get("state")}`);
    expect(denied.headers.get("location")).toBe("/einstellungen?fitbit=abgelehnt");
    const q2 = (await start()).searchParams;
    await env.DB.prepare("update health_oauth_state set created_at = ?").bind(new Date(Date.now() - 11 * 60_000).toISOString()).run();
    const old = await call(`/api/fitbit/callback?code=gueltiger-code&state=${q2.get("state")}`);
    expect(old.headers.get("location")).toBe("/einstellungen?fitbit=fehler");
    expect(await env.DB.prepare("select 1 from health_connection").first()).toBeNull();
  });

  it("falscher Code: Fehler, nichts gespeichert", async () => {
    const q = (await start()).searchParams;
    vi.stubGlobal("fetch", fakeGoogle().fetcher);
    const r = await call(`/api/fitbit/callback?code=falsch&state=${q.get("state")}`);
    expect(r.headers.get("location")).toBe("/einstellungen?fitbit=fehler");
    expect(await env.DB.prepare("select 1 from health_connection").first()).toBeNull();
  });
});

describe("Abgleich und Trennen über die API", () => {
  it("Sync ohne Verbindung: 409; mit Verbindung: Ergebnis; Trennen löscht", async () => {
    expect((await call("/api/fitbit/sync", "POST", {})).status).toBe(409);
    const q = (await start()).searchParams;
    const g = fakeGoogle();
    vi.stubGlobal("fetch", g.fetcher);
    await call(`/api/fitbit/callback?code=gueltiger-code&state=${q.get("state")}`);
    const r = await call("/api/fitbit/sync", "POST", {});
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, connected: true });
    const w = (await (await call("/api/fitbit/workouts?from=2026-11-13&to=2026-11-13")).json()) as { type: string }[];
    expect(w).toHaveLength(1);
    expect(w[0].type).toBe("STRENGTH_TRAINING");
    expect(await (await call("/api/fitbit/connection", "DELETE")).json()).toEqual({ ok: true });
    expect(JSON.parse(await (await call("/api/fitbit/status")).text())).toMatchObject({ connected: false });
    expect(g.calls.some((c) => c.url.pathname === "/revoke")).toBe(true);
  });
  it("ohne Anmeldung kein Zugriff (Access-Prüfung greift auch hier)", async () => {
    const r = await exports.default.fetch("https://dashboard.example/api/fitbit/status");
    expect([401, 503]).toContain(r.status);
  });
});
