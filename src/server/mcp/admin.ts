// Verwaltung des Connectors unter /api/connector, hinter Cloudflare Access und checkAccess (wie die übrige API).
//   GET    /api/connector/grants                 erteilte Zugriffe (Client, Rechte, Datum)
//   DELETE /api/connector/grants/:grantId        Zugriff widerrufen (Tokens werden ungültig)
//   GET    /api/connector/clients                registrierte Clients (Dynamic Client Registration)
//   DELETE /api/connector/clients?client_id=…    Client löschen und alle seine Zugriffe widerrufen
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { JWTVerifyGetKey } from "jose";
import { checkAccess } from "../auth";
import { OWNER_USER_ID, json, type McpEnv } from "./env";

const GRANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function clientName(oauth: OAuthHelpers, clientId: string): Promise<string | null> {
  try {
    return (await oauth.lookupClient(clientId))?.clientName ?? null;
  } catch {
    return null;
  }
}

async function allGrants(oauth: OAuthHelpers) {
  const out = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(OWNER_USER_ID, { limit: 100, cursor });
    out.push(...page.items);
    cursor = page.cursor;
  } while (cursor && out.length < 1000);
  return out;
}

export async function handleAdmin(req: Request, env: McpEnv, oauth: OAuthHelpers, accessKey?: JWTVerifyGetKey): Promise<Response> {
  const login = await checkAccess(req, env, accessKey);
  if (!login.ok) return json({ error: login.reason }, login.status);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/connector/grants" && req.method === "GET") {
    const grants = await allGrants(oauth);
    const names = new Map<string, string | null>();
    for (const g of grants) if (!names.has(g.clientId)) names.set(g.clientId, await clientName(oauth, g.clientId));
    return json(
      grants
        .map((g) => ({
          id: g.id,
          clientId: g.clientId,
          clientName: names.get(g.clientId) ?? null,
          scope: g.scope,
          redirectUri: g.redirectUri ?? g.metadata?.redirectUri ?? null,
          createdAt: new Date(g.createdAt * 1000).toISOString(),
          expiresAt: g.expiresAt ? new Date(g.expiresAt * 1000).toISOString() : null,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  const m = /^\/api\/connector\/grants\/([^/]+)$/.exec(path);
  if (m && req.method === "DELETE") {
    const grantId = decodeURIComponent(m[1]);
    if (!GRANT_ID.test(grantId)) return json({ error: "Ungültige Eingabe" }, 400);
    const exists = (await allGrants(oauth)).some((g) => g.id === grantId);
    if (!exists) return json({ error: "Nicht gefunden" }, 404);
    await oauth.revokeGrant(grantId, OWNER_USER_ID);
    return json({ ok: true });
  }

  if (path === "/api/connector/clients" && req.method === "GET") {
    const out = [];
    let cursor: string | undefined;
    do {
      const page = await oauth.listClients({ limit: 100, cursor });
      out.push(...page.items);
      cursor = page.cursor;
    } while (cursor && out.length < 1000);
    return json(
      out.map((c) => ({
        clientId: c.clientId,
        clientName: c.clientName ?? null,
        redirectUris: c.redirectUris,
        tokenEndpointAuthMethod: c.tokenEndpointAuthMethod ?? null,
        registeredAt: c.registrationDate ? new Date(c.registrationDate * 1000).toISOString() : null,
      })),
    );
  }

  if (path === "/api/connector/clients" && req.method === "DELETE") {
    const clientId = url.searchParams.get("client_id") ?? "";
    if (!clientId || clientId.length > 512) return json({ error: "Ungültige Eingabe" }, 400);
    const known = (await oauth.lookupClient(clientId).catch(() => null)) ?? (await allGrants(oauth)).find((g) => g.clientId === clientId);
    if (!known) return json({ error: "Nicht gefunden" }, 404);
    await oauth.deleteClient(clientId);
    return json({ ok: true });
  }

  return json({ error: "Nicht gefunden" }, 404);
}
