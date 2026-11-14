// Zustimmungsseite /authorize. Liegt hinter Cloudflare Access und prüft zusätzlich selber das Access-JWT
// (checkAccess aus auth.ts). Nur der angemeldete Besitzer kann einem Client Zugriff geben, und nur per Klick.
import { AuthorizationError, CimdFetchError, authorizationErrorRedirect, type AuthRequest, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { JWTVerifyGetKey } from "jose";
import { checkAccess } from "../auth";
import { OWNER_USER_ID, type GrantProps, type McpEnv } from "./env";
import { SCOPES, SCOPE_LABELS, isScope } from "./scopes";

/** Hosts, an die ein Code gehen darf: Claude (Web, Desktop, App) und ChatGPT. Loopback nur mit Warnung. */
export const REDIRECT_HOSTS = new Set(["claude.ai", "claude.com", "chatgpt.com"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && REDIRECT_HOSTS.has(u.hostname)) return true;
    return LOOPBACK.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:");
  } catch {
    return false;
  }
}

function page(title: string, body: string, status = 200, headers?: Headers, formTarget?: string): Response {
  const h = headers ?? new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  // form-action muss das Weiterleitungsziel nach dem Absenden erlauben (Chrome prüft Redirects nach POST).
  h.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTarget ? ` ${formTarget}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
  );
  const html = `<!doctype html>
<html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#000;color:#fff;font:16px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:24px 16px}
main{max-width:460px;margin:0 auto}
h1{font-size:24px;margin:8px 0 16px}
.card{background:#1c1c1e;border-radius:18px;padding:16px;margin:12px 0}
.k{color:#8e8e93;font-size:13px}.v{word-break:break-all}
.warn{background:#3a2a00;color:#ffd60a}
label{display:flex;gap:10px;align-items:flex-start;padding:8px 0}
input[type=checkbox]{width:20px;height:20px;margin-top:2px}
.row{display:flex;gap:12px;margin-top:20px}
button{flex:1;border:0;border-radius:14px;padding:14px;font-size:17px;font-weight:600}
.yes{background:#fff;color:#000}.no{background:#2c2c2e;color:#fff}
code{font-size:13px;color:#8e8e93}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: h });
}

function errorPage(msg: string, status = 400): Response {
  return page("Fehler", `<h1>Geht nicht</h1><div class="card">${esc(msg)}</div>`, status);
}

function consentHtml(d: ConsentDescription, handle: string, scopes: string[]): string {
  const requested = new Set(scopes);
  const boxes = SCOPES.map(
    (s) =>
      `<label><input type="checkbox" name="scope" value="${esc(s)}"${requested.has(s) ? " checked" : ""}><span><b>${esc(s)}</b><br><span class="k">${esc(SCOPE_LABELS[s])}</span></span></label>`,
  ).join("");
  const origin = d.clientDomain
    ? `Veröffentlicht von <b>${esc(d.clientDomain)}</b> (geprüft über die Adresse des Clients).`
    : "Der Client hat sich selber registriert; sein Name ist nicht geprüft.";
  return `<h1>Zugriff erlauben?</h1>
<div class="card"><div class="k">Client</div><div class="v"><b>${esc(d.clientName)}</b></div><div class="k" style="margin-top:6px">${origin}</div></div>
<div class="card"><div class="k">Zugriff geht an</div><div class="v"><b>${esc(d.redirectHost)}</b></div><div class="k v" style="margin-top:6px"><code>${esc(d.redirectUri)}</code></div></div>
${d.redirectIsLoopback ? `<div class="card warn">Der Zugriff geht an ein Programm auf einem Computer (localhost). Nur erlauben, wenn du die Anmeldung gerade selber dort gestartet hast.</div>` : ""}
<form method="post">
<input type="hidden" name="handle" value="${esc(handle)}">
<div class="card"><div class="k">Rechte (abwählen, was der Client nicht bekommen soll)</div>${boxes}</div>
<div class="row"><button class="no" name="decision" value="deny">Ablehnen</button><button class="yes" name="decision" value="approve">Erlauben</button></div>
</form>`;
}

function requestedScopes(r: AuthRequest): string[] {
  const valid = r.scope.filter(isScope);
  // Fragt der Client nichts Bekanntes an, sind alle Rechte vorausgewählt; der Besitzer wählt selber ab.
  return valid.length ? valid : [...SCOPES];
}

function redirectOrigin(uri: string): string {
  return new URL(uri).origin;
}

export async function handleAuthorize(req: Request, env: McpEnv, oauth: OAuthHelpers, accessKey?: JWTVerifyGetKey): Promise<Response> {
  const login = await checkAccess(req, env, accessKey);
  if (!login.ok) return errorPage(login.reason, login.status);

  try {
    if (req.method === "GET") {
      const oauthReq = await oauth.parseAuthRequest(req);
      if (!oauthReq.codeChallenge || oauthReq.codeChallengeMethod !== "S256") {
        return Response.redirect(authorizationErrorRedirect(oauthReq, "invalid_request", "PKCE mit S256 ist Pflicht"), 302);
      }
      if (!redirectAllowed(oauthReq.redirectUri)) return errorPage(`Weiterleitung an ${oauthReq.redirectUri} ist nicht erlaubt.`);
      const details = await oauth.describeConsent(oauthReq);
      const consent = await oauth.beginConsent(oauthReq);
      return page("Zugriff erlauben", consentHtml(details, consent.handle, requestedScopes(oauthReq)), 200, consent.headers, redirectOrigin(oauthReq.redirectUri));
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const scope = [...new Set(form.getAll("scope").map(String))].filter(isScope);
      if (!scope.length) return errorPage("Mindestens ein Recht auswählen. Starte die Verbindung im Client neu.");
      const approved = await oauth.approveConsent(req, handle, { scope });
      const r = approved.request;
      if (!r.codeChallenge || r.codeChallengeMethod !== "S256" || !redirectAllowed(r.redirectUri)) return errorPage("Anfrage ungültig.");
      const props: GrantProps = { email: login.email };
      const { redirectTo } = await oauth.completeAuthorization({
        request: r,
        userId: OWNER_USER_ID,
        metadata: { approvedAt: new Date().toISOString(), redirectUri: r.redirectUri },
        scope: r.scope,
        props,
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return errorPage("Methode nicht erlaubt.", 405);
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description || "Anfrage ungültig.");
    if (e instanceof CimdFetchError) return errorPage("Der Client konnte nicht geprüft werden (Metadaten nicht erreichbar).", 502);
    throw e;
  }
}
