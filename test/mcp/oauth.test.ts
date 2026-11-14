// OAuth-Ablauf des Connectors und alle Ablehnungen.
import { describe, expect, it } from "vitest";
import {
  CLAUDE_REDIRECT,
  ORIGIN,
  RESOURCE,
  accessJwt,
  call,
  connect,
  openConsent,
  pkce,
  register,
  rpc,
  submitConsent,
  testEnv,
  tokenRequest,
} from "./helpers";

describe("Metadaten und 401", () => {
  it("liefert Protected Resource Metadata ohne Access-Cookie", async () => {
    for (const p of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await call(p);
      expect(res.status, p).toBe(200);
      const m = (await res.json()) as Record<string, unknown>;
      expect(m.resource).toBe(RESOURCE);
      expect(m.authorization_servers).toEqual([ORIGIN]);
    }
  });

  it("liefert Authorization Server Metadata mit S256, none und Registrierung", async () => {
    const res = await call("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const m = (await res.json()) as Record<string, any>;
    expect(m.issuer).toBe(ORIGIN);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.token_endpoint_auth_methods_supported).toContain("none");
    expect(m.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(m.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(m.authorization_response_iss_parameter_supported).toBe(true);
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.scopes_supported).toEqual(expect.arrayContaining(["tasks", "calendar", "school", "gym", "money:read", "health:read"]));
  });

  it("/mcp ohne Token: 401 mit resource_metadata", async () => {
    const { res } = await rpc(null, "initialize", {});
    expect(res.status).toBe(401);
    const www = res.headers.get("www-authenticate") ?? "";
    expect(www).toMatch(/^Bearer /);
    expect(www).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("/mcp mit fremdem oder kaputtem Token: 401", async () => {
    for (const tok of ["abc", "x:y:z", (await accessJwt()) as string]) {
      const { res } = await rpc(tok, "tools/list");
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("invalid_token");
    }
  });

  it("/mcp ignoriert ein gültiges Access-JWT ohne Bearer-Token", async () => {
    const { res } = await rpc(null, "tools/list", undefined, { "cf-access-jwt-assertion": await accessJwt() });
    expect(res.status).toBe(401);
  });
});

describe("Zustimmungsseite", () => {
  it("geht ohne Access-JWT nicht", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const res = await call(`/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`, {
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('name="handle"');
  });

  it("geht mit dem JWT einer fremden Person nicht", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge }, await accessJwt("fremd@example.com"));
    expect(c.res.status).toBe(403);
  });

  it("geht mit falscher Audience nicht", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge }, await accessJwt(undefined, "andere"));
    expect(c.res.status).toBe(401);
  });

  it("ist ohne Login-Konfiguration gesperrt", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const res = await call(
      `/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`,
      { headers: { "cf-access-jwt-assertion": await accessJwt() } },
      testEnv({ OWNER_EMAIL: undefined }),
    );
    expect(res.status).toBe(503);
  });

  it("zeigt Client-Name, Redirect-Adresse und Rechte, verlangt Klick", async () => {
    const clientId = await register([CLAUDE_REDIRECT], "Claude <script>x</script>");
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, scope: "tasks school", challenge });
    expect(c.res.status).toBe(200);
    expect(c.html).toContain("Claude &#60;script&#62;");
    expect(c.html).not.toContain("<script>x");
    expect(c.html).toContain("claude.ai");
    expect(c.html).toContain(CLAUDE_REDIRECT);
    expect(c.html).toMatch(/value="tasks" checked/);
    expect(c.html).toMatch(/value="school" checked/);
    expect(c.html).toMatch(/value="gym">/);
    expect(c.html).toContain('value="approve"');
    expect(c.res.headers.get("x-frame-options")).toBe("DENY");
    expect(c.res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("verlangt PKCE mit S256", async () => {
    const clientId = await register();
    const none = await openConsent({ clientId, challenge: null });
    expect(none.handle).toBe("");
    expect([302, 400]).toContain(none.res.status);
    if (none.res.status === 302) expect(new URL(none.res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const plain = await openConsent({ clientId, challenge: "a".repeat(43), method: "plain" });
    expect(plain.handle).toBe("");
  });

  it("lehnt eine nicht registrierte Redirect-URI ab, ohne dorthin zu leiten", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    for (const redirectUri of ["https://evil.example/cb", `${CLAUDE_REDIRECT}/x`, `${CLAUDE_REDIRECT}?a=1`, "https://claude.ai/api/mcp/auth_callbacK"]) {
      const c = await openConsent({ clientId, challenge, redirectUri });
      expect(c.res.status, redirectUri).toBe(400);
      expect(c.res.headers.get("location")).toBeNull();
    }
  });

  it("lehnt registrierte, aber nicht erlaubte Redirect-Hosts ab", async () => {
    const clientId = await register(["https://evil.example/cb"], "Böse");
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge, redirectUri: "https://evil.example/cb" });
    expect(c.res.status).toBe(400);
    expect(c.handle).toBe("");
  });

  it("Ablehnen leitet mit access_denied zurück, ohne Code", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge });
    const r = await submitConsent(c.handle, c.cookie, "deny", []);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CLAUDE_REDIRECT);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("code")).toBeNull();
  });

  it("Absenden ohne Cookie der Seite (fremder Browser, CSRF) geht nicht", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge });
    const r = await submitConsent(c.handle, "", "approve", ["tasks"]);
    expect(r.status).not.toBe(302);
  });

  it("Absenden ohne Access-JWT geht nicht", async () => {
    const clientId = await register();
    const { challenge } = await pkce();
    const c = await openConsent({ clientId, challenge });
    const form = new URLSearchParams({ handle: c.handle, decision: "approve", scope: "tasks" });
    const r = await call(`${ORIGIN}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: c.cookie }, body: form, redirect: "manual" });
    expect(r.status).toBe(401);
  });
});

describe("Token", () => {
  it("ganzer Ablauf: Code mit iss, Token, Refresh mit Rotation", async () => {
    const clientId = await register();
    const { verifier, challenge } = await pkce();
    const c = await openConsent({ clientId, scope: "tasks gym", challenge, state: "abc123" });
    // Abgewählt wird gym: das Token bekommt nur, was der Besitzer erlaubt.
    const r = await submitConsent(c.handle, c.cookie, "approve", ["tasks"]);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CLAUDE_REDIRECT);
    expect(loc.searchParams.get("state")).toBe("abc123");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    const code = loc.searchParams.get("code")!;

    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
    expect(t.status).toBe(200);
    const tok = (await t.json()) as Record<string, any>;
    expect(tok.token_type.toLowerCase()).toBe("bearer");
    expect(tok.scope).toBe("tasks");
    expect(tok.expires_in).toBeLessThanOrEqual(30 * 60);
    expect(tok.refresh_token).toBeTruthy();

    const list = await rpc(tok.access_token, "tools/list");
    expect(list.res.status).toBe(200);
    const names = (list.body.result.tools as { name: string }[]).map((x) => x.name);
    expect(names).toContain("add_task");
    expect(names).not.toContain("log_workout");

    const ref = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId });
    expect(ref.status).toBe(200);
    const tok2 = (await ref.json()) as Record<string, any>;
    expect(tok2.access_token).not.toBe(tok.access_token);
    expect(tok2.refresh_token).not.toBe(tok.refresh_token);
    expect((await rpc(tok2.access_token, "tools/list")).res.status).toBe(200);
    // Nach Benutzung des neuen Refresh-Tokens ist das alte ungültig.
    const ref2 = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok2.refresh_token, client_id: clientId });
    expect(ref2.status).toBe(200);
    const old = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: clientId });
    expect(old.status).toBe(400);
    expect(((await old.json()) as any).error).toBe("invalid_grant");
  });

  async function freshCode() {
    const clientId = await register();
    const { verifier, challenge } = await pkce();
    const c = await openConsent({ clientId, scope: "tasks", challenge });
    const r = await submitConsent(c.handle, c.cookie, "approve", ["tasks"]);
    return { clientId, verifier, code: new URL(r.headers.get("location")!).searchParams.get("code")! };
  }

  it("lehnt falschen code_verifier ab", async () => {
    const { clientId, code } = await freshCode();
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: (await pkce()).verifier });
    expect(t.status).toBe(400);
    expect(((await t.json()) as any).error).toBe("invalid_grant");
  });

  it("lehnt fehlenden code_verifier ab", async () => {
    const { clientId, code } = await freshCode();
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId });
    expect(t.status).toBe(400);
  });

  it("lehnt falsche Redirect-URI beim Tausch ab", async () => {
    const { clientId, code, verifier } = await freshCode();
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", client_id: clientId, code_verifier: verifier });
    expect(t.status).toBe(400);
  });

  it("lehnt einen wiederverwendeten Code ab", async () => {
    const { clientId, code, verifier } = await freshCode();
    const p = { grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier };
    expect((await tokenRequest(p)).status).toBe(200);
    const again = await tokenRequest(p);
    expect(again.status).toBe(400);
    expect(((await again.json()) as any).error).toBe("invalid_grant");
  });

  it("lehnt einen Code eines anderen Clients ab", async () => {
    const { code, verifier } = await freshCode();
    const other = await register();
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: other, code_verifier: verifier });
    expect(t.status).toBe(400);
  });

  it("lehnt einen abgelaufenen Code ab", async () => {
    const { clientId, code, verifier } = await freshCode();
    const real = Date.now;
    // Codes gelten 5 Minuten; 6 Minuten später.
    Date.now = () => real() + 6 * 60 * 1000;
    try {
      const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier });
      expect(t.status).toBe(400);
      expect(((await t.json()) as any).error).toBe("invalid_grant");
    } finally {
      Date.now = real;
    }
  });

  it("abgelaufenes Access-Token gibt 401", async () => {
    const tok = await connect(["tasks"]);
    const real = Date.now;
    Date.now = () => real() + 31 * 60 * 1000;
    try {
      const { res } = await rpc(tok.access_token, "tools/list");
      expect(res.status).toBe(401);
    } finally {
      Date.now = real;
    }
  });

  it("lehnt ein Token für eine andere Ressource ab", async () => {
    const { clientId, code, verifier } = await freshCode();
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier, resource: "https://evil.example/mcp" });
    expect(t.status).toBe(400);
  });
});

describe("Rechte", () => {
  it("falscher Scope: 403 insufficient_scope beim Werkzeugaufruf", async () => {
    const tok = await connect(["tasks"]);
    const { res } = await rpc(tok.access_token, "tools/call", { name: "money_summary", arguments: {} });
    expect(res.status).toBe(403);
    const www = res.headers.get("www-authenticate") ?? "";
    expect(www).toContain('error="insufficient_scope"');
    expect(www).toContain("money:read");
    expect(www).toContain("resource_metadata=");
  });

  it("tools/list zeigt nur erlaubte Werkzeuge", async () => {
    const tok = await connect(["money:read", "health:read"]);
    const { body } = await rpc(tok.access_token, "tools/list");
    const names = (body.result.tools as { name: string }[]).map((x) => x.name).sort();
    expect(names).toEqual(["health_summary", "money_summary"]);
  });

  it("die Zustimmung kann keine unbekannten Rechte vergeben", async () => {
    const clientId = await register();
    const { verifier, challenge } = await pkce();
    const c = await openConsent({ clientId, scope: "tasks admin", challenge });
    expect(c.html).not.toContain('value="admin"');
    const r = await submitConsent(c.handle, c.cookie, "approve", ["tasks", "admin", "money:write"]);
    const code = new URL(r.headers.get("location")!).searchParams.get("code")!;
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(((await t.json()) as any).scope).toBe("tasks");
  });
});

describe("Verwaltung /api/connector", () => {
  it("braucht Access", async () => {
    expect((await call("/api/connector/grants")).status).toBe(401);
    expect((await call("/api/connector/clients")).status).toBe(401);
  });

  it("listet und widerruft Zugriffe; Tokens werden ungültig", async () => {
    const tok = await connect(["tasks"]);
    const h = { "cf-access-jwt-assertion": await accessJwt() };
    const list = (await (await call("/api/connector/grants", { headers: h })).json()) as { id: string; clientId: string; clientName: string; scope: string[] }[];
    const g = list.find((x) => x.clientId === tok.clientId)!;
    expect(g).toBeTruthy();
    expect(g.clientName).toBe("Claude");
    expect(g.scope).toEqual(["tasks"]);
    expect(JSON.stringify(list)).not.toContain(tok.access_token);

    const del = await call(`/api/connector/grants/${g.id}`, { method: "DELETE", headers: h });
    expect(del.status).toBe(200);
    expect((await rpc(tok.access_token, "tools/list")).res.status).toBe(401);
    const ref = await tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: tok.clientId });
    expect(ref.status).toBe(400);
    expect((await call(`/api/connector/grants/${g.id}`, { method: "DELETE", headers: h })).status).toBe(404);
  });

  it("listet und löscht Clients; deren Tokens werden ungültig", async () => {
    const tok = await connect(["tasks"]);
    const h = { "cf-access-jwt-assertion": await accessJwt() };
    const clients = (await (await call("/api/connector/clients", { headers: h })).json()) as { clientId: string; redirectUris: string[] }[];
    expect(clients.find((c) => c.clientId === tok.clientId)?.redirectUris).toEqual([CLAUDE_REDIRECT]);
    const del = await call(`/api/connector/clients?client_id=${encodeURIComponent(tok.clientId)}`, { method: "DELETE", headers: h });
    expect(del.status).toBe(200);
    expect((await rpc(tok.access_token, "tools/list")).res.status).toBe(401);
  });
});

describe("Schutz", () => {
  it("Rate-Limit pro Token auf /mcp", async () => {
    const tok = await connect(["tasks"]);
    let n = 0;
    const limiter = { limit: async () => ({ success: ++n <= 2 }) } as unknown as RateLimit;
    const e = testEnv({ MCP_RATE_LIMIT: limiter });
    const send = () =>
      call("/mcp", { method: "POST", headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, e);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
  });

  it("Rate-Limit pro IP auf Registrierung", async () => {
    const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await call("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, testEnv({ OAUTH_RATE_LIMIT: limiter }));
    expect(res.status).toBe(429);
  });

  it("fremde Browser-Herkunft auf /mcp wird abgewiesen", async () => {
    const tok = await connect(["tasks"]);
    const { res } = await rpc(tok.access_token, "tools/list", undefined, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("die übrige App bleibt hinter Access", async () => {
    const tok = await connect(["tasks"]);
    // Ein Connector-Token öffnet die normale API nicht.
    const res = await call("/api/tasks", { headers: { authorization: `Bearer ${tok.access_token}` } });
    expect(res.status).toBe(401);
  });
});
