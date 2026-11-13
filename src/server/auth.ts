// Login-Prüfung: Cloudflare Access steht vor dem Worker. Der Worker prüft zusätzlich das Access-JWT
// (Signatur, Aussteller, Audience) und dass es dem Besitzer gehört. Fehlt die Konfiguration, ist alles gesperrt.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  /** Nur in .dev.vars: erlaubt Anfragen ohne Login, aber ausschliesslich an localhost. */
  ALLOW_LOCAL_NOAUTH?: string;
}

export type AuthResult = { ok: true; email: string } | { ok: false; status: 401 | 403 | 503; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const jwksCache = new Map<string, JWTVerifyGetKey>();

function teamHost(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function jwksFor(domain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
    jwksCache.set(domain, jwks);
  }
  return jwks;
}

export async function checkAccess(req: Request, env: AuthEnv, getKey?: JWTVerifyGetKey): Promise<AuthResult> {
  const url = new URL(req.url);
  if (env.ALLOW_LOCAL_NOAUTH === "1" && LOCAL_HOSTS.has(url.hostname)) {
    return { ok: true, email: "lokal" };
  }

  const domain = env.ACCESS_TEAM_DOMAIN ? teamHost(env.ACCESS_TEAM_DOMAIN) : "";
  const aud = env.ACCESS_AUD ?? "";
  const owner = (env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!domain || !aud || !owner) {
    return { ok: false, status: 503, reason: "Login ist nicht eingerichtet." };
  }

  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401, reason: "Nicht angemeldet." };

  try {
    const { payload } = await jwtVerify(token, getKey ?? jwksFor(domain), {
      issuer: `https://${domain}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (email !== owner) return { ok: false, status: 403, reason: "Kein Zugriff." };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 401, reason: "Anmeldung ungültig." };
  }
}
