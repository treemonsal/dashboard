import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { checkAccess } from "../src/server/auth";

const env = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123", OWNER_EMAIL: "owner@example.com" };

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, aud = "aud123", iss = "https://team.cloudflareaccess.com") =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setAudience(aud).setIssuer(iss).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  return { getKey, sign };
}
const req = (token?: string, host = "dashboard.example.workers.dev") =>
  new Request(`https://${host}/api/tasks`, { headers: token ? { "cf-access-jwt-assertion": token } : {} });

describe("Access-Prüfung", () => {
  it("sperrt alles, wenn Login nicht eingerichtet ist", async () => {
    expect(await checkAccess(req(), {})).toMatchObject({ ok: false, status: 503 });
  });
  it("erlaubt die lokale Ausnahme nur auf localhost", async () => {
    expect(await checkAccess(new Request("http://localhost:8787/"), { ALLOW_LOCAL_NOAUTH: "1" })).toMatchObject({ ok: true });
    expect(await checkAccess(req(), { ALLOW_LOCAL_NOAUTH: "1" })).toMatchObject({ ok: false });
  });
  it("lässt nur den Besitzer mit gültigem Token durch", async () => {
    const { getKey, sign } = await setup();
    expect(await checkAccess(req(), env, getKey)).toMatchObject({ ok: false, status: 401 });
    expect(await checkAccess(req(await sign({ email: "Owner@Example.com" })), env, getKey)).toMatchObject({ ok: true });
    expect(await checkAccess(req(await sign({ email: "fremd@example.com" })), env, getKey)).toMatchObject({ ok: false, status: 403 });
    expect(await checkAccess(req(await sign({ email: "owner@example.com" }, "andere-aud")), env, getKey)).toMatchObject({ ok: false, status: 401 });
    expect(await checkAccess(req(await sign({ email: "owner@example.com" }, "aud123", "https://evil.example")), env, getKey)).toMatchObject({ ok: false, status: 401 });
  });
  it("antwortet ohne Login mit 503 statt Daten (über die App)", async () => {
    const { exports } = await import("cloudflare:workers");
    const res = await exports.default.fetch("https://dashboard.example.workers.dev/api/exams");
    expect(res.status).toBe(503);
  });
});
