// /mcp: läuft nur, wenn der OAuthProvider ein gültiges, selbst ausgestelltes Token geprüft hat (ctx.auth).
// Hier zusätzlich: Origin-Prüfung, Rate-Limit pro Token, Rechte-Prüfung pro Werkzeug, dann das MCP-SDK.
import { insufficientScope, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { SECURITY_HEADERS, json, sha256Hex, withHeaders, type GrantProps, type McpEnv } from "./env";
import { TOOL_SCOPES } from "./scopes";
import { buildServer } from "./tools";

const MAX_BODY = 256 * 1024;

/** Browser-Herkunft, die /mcp aufrufen darf. Server-zu-Server-Aufrufe (Claude, ChatGPT) senden keinen Origin. */
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://claude.com", "https://chatgpt.com"]);

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(req.url).origin || ALLOWED_ORIGINS.has(origin);
}

async function neededScope(req: Request): Promise<string | null> {
  if (req.method !== "POST") return null;
  try {
    const body = (await req.clone().json()) as { method?: unknown; params?: { name?: unknown } };
    if (body && body.method === "tools/call" && typeof body.params?.name === "string") {
      return (TOOL_SCOPES as Record<string, string>)[body.params.name] ?? null;
    }
  } catch {
    // Kein gültiges JSON: das SDK antwortet mit dem passenden Fehler.
  }
  return null;
}

export const mcpApiHandler = {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const { auth } = ctx as unknown as OAuthResourceContext<GrantProps>;
    if (!originAllowed(request)) return json({ jsonrpc: "2.0", error: { code: -32600, message: "Origin nicht erlaubt" } }, 403);

    const len = Number(request.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) return json({ jsonrpc: "2.0", error: { code: -32600, message: "Anfrage zu gross" } }, 413);

    if (env.MCP_RATE_LIMIT) {
      const key = (await sha256Hex(auth.token)).slice(0, 32);
      const { success } = await env.MCP_RATE_LIMIT.limit({ key });
      if (!success) return json({ jsonrpc: "2.0", error: { code: -32000, message: "Zu viele Anfragen, bitte kurz warten." } }, 429, { "Retry-After": "60" });
    }

    const need = await neededScope(request);
    if (need && !auth.scope.includes(need)) {
      // Step-up nach MCP: alle nötigen Rechte in einer Antwort nennen (bisherige plus fehlendes).
      return insufficientScope(auth, [...new Set([...auth.scope, need])], `Dieses Werkzeug braucht das Recht "${need}".`);
    }

    const db = drizzle(env.DB, { schema });
    const handler = createMcpHandler(() => buildServer(db, auth.scope, env), {
      maxRequestBodySize: MAX_BODY,
      keepAliveMs: 0,
      onerror: (e) => console.warn("mcp", e.message),
    });
    const res = await handler.fetch(request, {
      authInfo: { token: auth.token, clientId: auth.clientId ?? "", scopes: auth.scope, expiresAt: auth.expiresAt, resource: new URL(auth.audience) },
    });
    return withHeaders(res, SECURITY_HEADERS);
  },
};
