// Web Push im Worker, nur mit Web Crypto: VAPID (RFC 8292, ES256-JWT) und Nachrichtenverschlüsselung aes128gcm (RFC 8291).

const te = new TextEncoder();

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

/* ---------- VAPID ---------- */

export interface VapidConfig {
  /** Öffentlicher Schlüssel, unkomprimiert (65 Byte), base64url. */
  publicKey: string;
  /** Privater Schlüssel (32 Byte), base64url. Kommt aus dem Secret VAPID_PRIVATE_KEY. */
  privateKey: string;
  /** mailto: oder https-Adresse des Betreibers. */
  subject: string;
}

async function signingKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64uDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("Öffentlicher VAPID-Schlüssel ungültig");
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33)), d: privateKey, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Ziel der Mitteilung ohne Pfad, z.B. "https://web.push.apple.com". */
export const audienceOf = (endpoint: string) => new URL(endpoint).origin;

/** Signiertes JWT für einen Push-Dienst. `exp` höchstens 24 Stunden, hier 12. */
export async function vapidJwt(cfg: VapidConfig, audience: string, nowSec: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64uEncode(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64uEncode(te.encode(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: cfg.subject })));
  const key = await signingKey(cfg.publicKey, cfg.privateKey);
  // Web Crypto liefert r||s (64 Byte), genau das Format von JWS.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64uEncode(sig)}`;
}

export async function vapidAuthorization(cfg: VapidConfig, endpoint: string, nowSec?: number): Promise<string> {
  return `vapid t=${await vapidJwt(cfg, audienceOf(endpoint), nowSec)}, k=${cfg.publicKey}`;
}

/* ---------- Verschlüsselung (aes128gcm) ---------- */

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

export interface EncryptOptions {
  /** Nur für Tests mit festen Werten (RFC 8291, Anhang A). */
  salt?: Uint8Array;
  senderPrivate?: Uint8Array;
  senderPublic?: Uint8Array;
}

/** Ein Datensatz mit 4096 Byte: genug für kurze Mitteilungen. */
const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1 - 86;

/**
 * Verschlüsselt eine Nachricht für ein Abonnement. Ergebnis ist der fertige Körper der Anfrage:
 * salt(16) | rs(4) | idlen(1) | Absender-Schlüssel(65) | Chiffretext.
 */
export async function encryptPayload(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opt: EncryptOptions = {}): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("Nachricht zu lang");
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Abonnement ungültig");
  const salt = opt.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (opt.senderPrivate && opt.senderPublic) {
    asPublic = opt.senderPublic;
    const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64uEncode(asPublic.slice(1, 33)), y: b64uEncode(asPublic.slice(33)), d: b64uEncode(opt.senderPrivate), ext: true };
    asPrivateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    asPrivateKey = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivateKey, 256));

  // RFC 8291 3.4: IKM aus Auth-Geheimnis, dann CEK und Nonce aus dem Salt (RFC 8188).
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Das letzte (einzige) Datensatz-Ende wird mit 0x02 markiert.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* ---------- Senden ---------- */

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Sendet eine Mitteilung. Liefert den HTTP-Status des Push-Dienstes, 0 bei Netzwerkfehler.
 * 404 und 410 heissen: Abo ist abgelaufen und kann gelöscht werden.
 */
export async function sendWebPush(sub: PushSubscriptionRow, msg: PushMessage, cfg: VapidConfig, opt: { ttl?: number; fetcher?: typeof fetch; nowSec?: number } = {}): Promise<number> {
  const body = await encryptPayload(te.encode(JSON.stringify(msg)), b64uDecode(sub.p256dh), b64uDecode(sub.auth));
  try {
    const res = await (opt.fetcher ?? fetch)(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(cfg, sub.endpoint, opt.nowSec),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opt.ttl ?? 3600),
        Urgency: "normal",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    // Nie den Endpunkt loggen: er ist ein Zugang zum Gerät.
    return 0;
  }
}
