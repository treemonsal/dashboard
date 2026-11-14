// Einstieg des Workers mit MCP-Connector: OAuth 2.1 (Cloudflare workers-oauth-provider, Zustand in KV OAUTH_KV)
// vor der bestehenden App. Ohne Access-Cookie erreichbar sind nur:
//   /mcp (nur mit gültigem, selbst ausgestelltem Token), /oauth/token, /oauth/register, /.well-known/*
// Alles andere (Zustimmung /authorize, /api/*, Oberfläche) prüft weiterhin das Access-JWT.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { JWTVerifyGetKey } from "jose";
import { createApp } from "../app";
import { handleAdmin } from "./admin";
import { handleAuthorize } from "./consent";
import { json, withHeaders, type McpEnv } from "./env";
import { mcpApiHandler } from "./handler";
import { SCOPES } from "./scopes";

export const MCP_PATH = "/mcp";
export const AUTHORIZE_PATH = "/authorize";
export const TOKEN_PATH = "/oauth/token";
export const REGISTER_PATH = "/oauth/register";

/** Kurze Access-Tokens, Refresh-Tokens rotieren und verfallen nach 30 Tagen ohne Nutzung. */
export const ACCESS_TOKEN_TTL = 30 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 3600;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_ORIGIN = "https://dashboard.hahntim518.workers.dev";

export interface WorkerOptions {
  /** Nur für Tests: Schlüssel für das Access-JWT statt der Schlüssel von Cloudflare. */
  accessKey?: JWTVerifyGetKey;
}

/** Ausstellerin und Ressource: lokal (wrangler dev) die Adresse der Anfrage, sonst die feste öffentliche Adresse. */
function originFor(req: Request, env: McpEnv): string {
  const u = new URL(req.url);
  if (LOOPBACK.has(u.hostname)) return u.origin;
  return (env.MCP_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "").toLowerCase();
}

export function createWorker(opts: WorkerOptions = {}) {
  const app = createApp();
  const providers = new Map<string, OAuthProvider<McpEnv>>();

  const defaultHandler = {
    async fetch(req: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
      const path = new URL(req.url).pathname;
      const oauth = env.OAUTH_PROVIDER!;
      if (path === AUTHORIZE_PATH) return handleAuthorize(req, env, oauth, opts.accessKey);
      if (path === "/api/connector" || path.startsWith("/api/connector/")) return handleAdmin(req, env, oauth, opts.accessKey);
      // Übrige Discovery-Pfade (z.B. openid-configuration): ohne Access-Prüfung, aber leer.
      if (path.startsWith("/.well-known/")) return json({ error: "Nicht gefunden" }, 404);
      return app.fetch(req, env, ctx);
    },
  };

  function providerFor(origin: string): OAuthProvider<McpEnv> {
    let p = providers.get(origin);
    if (!p) {
      p = new OAuthProvider<McpEnv>({
        apiRoute: MCP_PATH,
        apiHandler: mcpApiHandler,
        defaultHandler,
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: TOKEN_PATH,
        clientRegistrationEndpoint: REGISTER_PATH,
        scopesSupported: [...SCOPES],
        // Alle Rechte im 401 nennen: der Besitzer wählt auf der Zustimmungsseite ab, was ein Client nicht bekommt.
        requiredScopes: [...SCOPES],
        resourceMetadata: {
          resource: `${origin}${MCP_PATH}`,
          authorization_servers: [origin],
          bearer_methods_supported: ["header"],
          resource_name: "Tims Dashboard",
        },
        accessTokenTTL: ACCESS_TOKEN_TTL,
        refreshTokenTTL: REFRESH_TOKEN_TTL,
        refreshTokenIdleTTL: REFRESH_TOKEN_TTL,
        clientIdMetadataDocumentEnabled: true,
        onError: ({ code, status, internal }) => {
          if (status >= 500) console.error("oauth", code, internal);
        },
      });
      providers.set(origin, p);
    }
    return p;
  }

  return {
    async fetch(req: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(req.url);
      const origin = originFor(req, env);
      // Wurzel-Variante der Resource-Metadaten (manche Clients fragen nur dort): auf /mcp abbilden.
      if (url.pathname === "/.well-known/oauth-protected-resource" && (req.method === "GET" || req.method === "HEAD")) {
        url.pathname = `/.well-known/oauth-protected-resource${MCP_PATH}`;
        req = new Request(url, req);
      }
      // Einfaches Rate-Limit pro IP auf den öffentlichen OAuth-Endpunkten (Registrierung und Token).
      if ((url.pathname === TOKEN_PATH || url.pathname === REGISTER_PATH) && req.method === "POST" && env.OAUTH_RATE_LIMIT) {
        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        const { success } = await env.OAUTH_RATE_LIMIT.limit({ key: `${url.pathname}:${ip}` });
        if (!success) return json({ error: "temporarily_unavailable", error_description: "Zu viele Anfragen" }, 429, { "Retry-After": "60" });
      }
      const res = await providerFor(origin).fetch(req, env, ctx);
      const p = url.pathname;
      const isOauth = p === MCP_PATH || p.startsWith(`${MCP_PATH}/`) || p === TOKEN_PATH || p === REGISTER_PATH || p.startsWith("/.well-known/");
      return isOauth ? withHeaders(res, { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }) : res;
    },
  };
}

