import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { fakeGoogle } from "./fake";

const call = (path: string, method = "GET", body?: unknown) =>
  exports.default.fetch("http://localhost" + path, { method, redirect: "manual", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
const ID = "123456-abcdefgh.apps.googleusercontent.com";
const SECRET = "GOCSPX-sehr-geheimes-secret-xyz";

beforeEach(async () => {
  for (const t of ["health_credentials", "health_connection", "health_oauth_state", "health_daily", "health_workouts", "sync_runs"]) await env.DB.exec(`DELETE FROM ${t}`);
  await env.DB.exec("DELETE FROM settings WHERE key = 'fitbitSetup'");
});
afterEach(() => vi.unstubAllGlobals());

describe("Zugangsdaten in der App", () => {
  it("speichern: verschlüsselt in D1, Antwort und Status zeigen nur die letzten 4 Zeichen", async () => {
    const r = await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET });
    const txt = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(txt).credentials).toEqual({ present: true, source: "app", idTail: ".com" });
    expect(txt).not.toContain(SECRET);
    expect(txt).not.toContain(ID);
    const status = await (await call("/api/fitbit/status")).text();
    expect(status).not.toContain(SECRET);
    expect(status).not.toContain("abcdefgh");
    const row = await env.DB.prepare("select * from health_credentials").first<Record<string, string>>();
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("abcdefgh");
    expect(row!.client_id_enc).toMatch(/^v1\./);
  });

  it("wirksam: App-Zugangsdaten gehen vor den Worker-Secrets (Start-Adresse und Token-Tausch)", async () => {
    await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET });
    const u = new URL(((await (await call("/api/fitbit/connect", "POST", {})).json()) as { url: string }).url);
    expect(u.searchParams.get("client_id")).toBe(ID);
    expect(u.toString()).not.toContain(SECRET);
    const g = fakeGoogle();
    vi.stubGlobal("fetch", g.fetcher);
    const r = await call(`/api/fitbit/callback?code=gueltiger-code&state=${u.searchParams.get("state")}`);
    expect(r.headers.get("location")).toBe("/einstellungen?fitbit=verbunden");
    const ex = g.calls.find((c) => c.url.pathname === "/token")!;
    expect(ex.form?.get("client_id")).toBe(ID);
    expect(ex.form?.get("client_secret")).toBe(SECRET);
  });

  it("Rückfall: ohne App-Eintrag gelten die Worker-Secrets, Status nennt die Quelle", async () => {
    const s = JSON.parse(await (await call("/api/fitbit/status")).text());
    expect(s.credentials).toMatchObject({ present: true, source: "secret" });
    expect(s.configured).toBe(true);
  });

  it("löschen: danach wieder Rückfall, Eintrag weg", async () => {
    await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET });
    const r = await call("/api/fitbit/credentials", "DELETE");
    expect((await r.json() as { ok: boolean }).ok).toBe(true);
    expect((await env.DB.prepare("select count(*) n from health_credentials").first<{ n: number }>())!.n).toBe(0);
    expect(JSON.parse(await (await call("/api/fitbit/status")).text()).credentials.source).toBe("secret");
  });

  it("ungültige Eingabe wird abgelehnt, nichts gespeichert", async () => {
    expect((await call("/api/fitbit/credentials", "PUT", { clientId: "kurz", clientSecret: SECRET })).status).toBe(400);
    expect((await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: "mit leerzeichen drin" })).status).toBe(400);
    expect((await env.DB.prepare("select count(*) n from health_credentials").first<{ n: number }>())!.n).toBe(0);
  });

  it("andere Client-ID trennt die alte Verbindung; gleiche ID nicht", async () => {
    await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET });
    await env.DB.exec("insert into health_connection (id, refresh_enc) values ('google','x')");
    await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET + "2" });
    expect((await env.DB.prepare("select count(*) n from health_connection").first<{ n: number }>())!.n).toBe(1);
    await call("/api/fitbit/credentials", "PUT", { clientId: "999999-anderer.apps.googleusercontent.net", clientSecret: SECRET });
    expect((await env.DB.prepare("select count(*) n from health_connection").first<{ n: number }>())!.n).toBe(0);
  });

  it("kein Klartext in Logs und Abgleichsprotokoll", async () => {
    const logs: string[] = [];
    for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.join(" ")));
    await call("/api/fitbit/credentials", "PUT", { clientId: ID, clientSecret: SECRET });
    await call("/api/fitbit/status");
    const u = new URL(((await (await call("/api/fitbit/connect", "POST", {})).json()) as { url: string }).url);
    const g = fakeGoogle();
    vi.stubGlobal("fetch", g.fetcher);
    await call(`/api/fitbit/callback?code=gueltiger-code&state=${u.searchParams.get("state")}`);
    for (let i = 0; i < 50 && !(await env.DB.prepare("select 1 from sync_runs").first()); i++) await new Promise((x) => setTimeout(x, 50));
    const runs = JSON.stringify((await env.DB.prepare("select * from sync_runs").all()).results);
    expect(runs).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain("abcdefgh");
    vi.restoreAllMocks();
  });
});

describe("Fortschritt der Einrichtung", () => {
  it("bleibt gespeichert, sortiert, ohne Doppelte; ungültige Nummern werden abgelehnt", async () => {
    expect(JSON.parse(await (await call("/api/fitbit/status")).text()).setup).toEqual([]);
    await call("/api/fitbit/setup", "PUT", { done: [3, 1, 3] });
    expect(JSON.parse(await (await call("/api/fitbit/status")).text()).setup).toEqual([1, 3]);
    expect((await call("/api/fitbit/setup", "PUT", { done: [9] })).status).toBe(400);
  });
});
