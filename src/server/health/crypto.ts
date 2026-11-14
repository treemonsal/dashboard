// Tokens liegen nur verschlüsselt in D1: AES-256-GCM, Schlüssel aus dem Secret HEALTH_TOKEN_KEY (SHA-256).
import { HealthError } from "./types";

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new HealthError("Schlüssel für Tokens fehlt oder ist zu kurz", "config");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Ergebnis: "v1.<iv>.<chiffre>" (Base64). Jede Verschlüsselung hat eine neue Zufallszahl. */
export async function encryptToken(plain: string, secret: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(stored: string, secret: string | undefined): Promise<string> {
  const [v, iv, ct] = stored.split(".");
  if (v !== "v1" || !iv || !ct) throw new HealthError("Gespeicherter Token ist unlesbar", "auth");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(secret), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch (e) {
    if (e instanceof HealthError) throw e;
    throw new HealthError("Gespeicherter Token ist mit diesem Schlüssel nicht lesbar. Neu verbinden.", "auth");
  }
}

const url64 = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomUrlSafe(bytes = 32): string {
  return url64(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE: code_challenge = BASE64URL(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return url64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

/** Kurzer, stabiler Hash (32 Hex-Zeichen) für Kennungen. */
export async function shortHash(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
