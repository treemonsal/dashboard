import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "../util";

/** Bindings, die der Connector zusätzlich zur App braucht (siehe wrangler.jsonc). */
export interface McpEnv extends Bindings {
  OAUTH_KV: KVNamespace;
  /** Pro Token auf /mcp */
  MCP_RATE_LIMIT?: RateLimit;
  /** Pro IP auf Registrierung und Token-Endpunkt */
  OAUTH_RATE_LIMIT?: RateLimit;
  /** Öffentliche Adresse, z.B. https://dashboard.hahntim518.workers.dev */
  MCP_ORIGIN?: string;
  /** Wird vom OAuthProvider für den defaultHandler gesetzt. */
  OAUTH_PROVIDER?: OAuthHelpers;
}

/** Was bei der Zustimmung im Grant gespeichert wird (verschlüsselt). */
export interface GrantProps {
  email: string;
}

/** Ein Benutzer: alle Zugriffe gehören dem Besitzer. */
export const OWNER_USER_ID = "owner";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers } });
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
