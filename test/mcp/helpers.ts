// Hilfen für die Connector-Tests: Worker mit Test-Schlüssel für das Access-JWT, OAuth-Ablauf wie ein MCP-Client.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { createWorker } from "../../src/server/mcp/worker";
import type { McpEnv } from "../../src/server/mcp/env";

export const ORIGIN = "https://dashboard.hahntim518.workers.dev";
export const RESOURCE = `${ORIGIN}/mcp`;
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const OWNER = "owner@example.com";

const keys = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" };
export const worker = createWorker({ accessKey: createLocalJWKSet({ keys: [jwk] }) });

/** Env wie in Produktion (Access eingerichtet), ohne Rate-Limits, damit viele Tests aus derselben "IP" laufen. */
export function testEnv(over: Partial<McpEnv> = {}): McpEnv {
  const base = env as unknown as McpEnv;
  return { ...base, OWNER_EMAIL: OWNER, ALLOW_LOCAL_NOAUTH: undefined, MCP_RATE_LIMIT: undefined, OAUTH_RATE_LIMIT: undefined, ...over } as McpEnv;
}

export async function accessJwt(email = OWNER, aud = (env as unknown as McpEnv).ACCESS_AUD!): Promise<string> {
  const iss = `https://${(env as unknown as McpEnv).ACCESS_TEAM_DOMAIN}`;
  return new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "test" }).setAudience(aud).setIssuer(iss).setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
}

export async function call(input: string | Request, init?: RequestInit, e: McpEnv = testEnv()): Promise<Response> {
  const req = typeof input === "string" ? new Request(input.startsWith("http") ? input : ORIGIN + input, init) : input;
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export async function register(redirectUris = [CLAUDE_REDIRECT], name = "Claude"): Promise<string> {
  const res = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: redirectUris, client_name: name, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  if (res.status !== 201) throw new Error(`register ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export interface AuthParams {
  clientId: string;
  redirectUri?: string;
  scope?: string;
  challenge?: string | null;
  method?: string;
  state?: string;
  resource?: string | null;
}

export function authorizeUrl(p: AuthParams): string {
  const q = new URLSearchParams({ response_type: "code", client_id: p.clientId, redirect_uri: p.redirectUri ?? CLAUDE_REDIRECT, state: p.state ?? "st4te" });
  if (p.scope !== undefined) q.set("scope", p.scope);
  if (p.challenge !== null && p.challenge !== undefined) {
    q.set("code_challenge", p.challenge);
    q.set("code_challenge_method", p.method ?? "S256");
  }
  if (p.resource !== null) q.set("resource", p.resource ?? RESOURCE);
  return `${ORIGIN}/authorize?${q}`;
}

const cookieHeader = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Zustimmungsseite laden (mit Access-JWT), Handle und Cookie herausholen. */
export async function openConsent(p: AuthParams, jwt?: string) {
  const res = await call(authorizeUrl(p), { headers: { "cf-access-jwt-assertion": jwt ?? (await accessJwt()) }, redirect: "manual" });
  const html = res.status === 200 ? await res.text() : "";
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
  return { res, html, handle, cookie: cookieHeader(res) };
}

export async function submitConsent(handle: string, cookie: string, decision: "approve" | "deny", scopes: string[], jwt?: string) {
  const form = new URLSearchParams({ handle, decision });
  for (const s of scopes) form.append("scope", s);
  return call(`${ORIGIN}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: ORIGIN, "cf-access-jwt-assertion": jwt ?? (await accessJwt()) },
    body: form,
    redirect: "manual",
  });
}

export async function tokenRequest(params: Record<string, string>) {
  return call("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  clientId: string;
}

/** Ganzer Ablauf bis zum Token. */
export async function connect(scopes: string[] = ["tasks", "calendar", "school", "gym", "money:read", "health:read"]): Promise<Tokens> {
  const clientId = await register();
  const { verifier, challenge } = await pkce();
  const c = await openConsent({ clientId, scope: scopes.join(" "), challenge });
  if (c.res.status !== 200) throw new Error(`consent ${c.res.status}`);
  const r = await submitConsent(c.handle, c.cookie, "approve", scopes);
  const loc = new URL(r.headers.get("location")!);
  const code = loc.searchParams.get("code")!;
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: CLAUDE_REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
  if (t.status !== 200) throw new Error(`token ${t.status} ${await t.text()}`);
  return { ...((await t.json()) as Omit<Tokens, "clientId">), clientId };
}

let rpcId = 1;

/** JSON-RPC an /mcp. Antwort als JSON oder als SSE (eine Nachricht). */
export async function rpc(token: string | null, method: string, params?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await call("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, ...(params === undefined ? {} : { params }) }) });
  const text = await res.text();
  let body: any = null;
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    body = line ? JSON.parse(line.slice(5)) : null;
  } else if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { res, body };
}

export async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { res, body } = await rpc(token, "tools/call", { name, arguments: args });
  return { res, body, result: body?.result as { isError?: boolean; structuredContent?: any; content: { type: string; text: string }[] } | undefined };
}
