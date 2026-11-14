import { describe, expect, it } from "vitest";
import { audienceOf, b64uDecode, b64uEncode, encryptPayload, sendWebPush, vapidAuthorization, vapidJwt } from "../src/server/webpush";
import { dueReminders, type ReminderInput } from "../src/shared/reminders";
import { zoneLocalToUtcMs } from "../src/shared/dates";

const te = new TextEncoder();
const td = new TextDecoder();

describe("Verschlüsselung nach RFC 8291", () => {
  // Anhang A des RFC: feste Schlüssel, Salt und Klartext.
  const v = {
    plaintext: "When I grow up, I want to be a watermelon",
    asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    body:
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  it("erzeugt genau den Körper aus dem Testvektor", async () => {
    const out = await encryptPayload(te.encode(v.plaintext), b64uDecode(v.uaPublic), b64uDecode(v.auth), {
      salt: b64uDecode(v.salt),
      senderPrivate: b64uDecode(v.asPrivate),
      senderPublic: b64uDecode(v.asPublic),
    });
    expect(b64uEncode(out)).toBe(v.body);
  });

  it("lässt sich mit dem privaten Schlüssel des Empfängers entschlüsseln (zufälliger Absenderschlüssel)", async () => {
    const msg = JSON.stringify({ title: "Prüfung morgen", body: "FRW, 08:00" });
    const body = await encryptPayload(te.encode(msg), b64uDecode(v.uaPublic), b64uDecode(v.auth));
    expect(body.length).toBe(16 + 4 + 1 + 65 + te.encode(msg).length + 1 + 16);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(td.decode(await decrypt(body, v.uaPrivate, v.uaPublic, v.auth))).toBe(msg);
  });

  it("weist zu lange Nachrichten und ungültige Abos ab", async () => {
    await expect(encryptPayload(new Uint8Array(4000), b64uDecode(v.uaPublic), b64uDecode(v.auth))).rejects.toThrow();
    await expect(encryptPayload(te.encode("x"), new Uint8Array(10), b64uDecode(v.auth))).rejects.toThrow();
    await expect(encryptPayload(te.encode("x"), b64uDecode(v.uaPublic), new Uint8Array(3))).rejects.toThrow();
  });
});

/** Unabhängige Gegenstelle: entschlüsselt aes128gcm so, wie es der Browser tut. */
async function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPub = b64uDecode(uaPublic);
  const priv = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64uEncode(uaPub.slice(1, 33)), y: b64uEncode(uaPub.slice(33)), d: uaPrivate, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as never, priv, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const info = new Uint8Array([...te.encode("WebPush: info\0"), ...uaPub, ...asPub]);
  const ikm = await hk(b64uDecode(auth), secret, info, 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  expect(plain[end]).toBe(2);
  return plain.slice(0, end);
}

async function vapidPair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const d = ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d!;
  return { pair, cfg: { publicKey: b64uEncode(pub), privateKey: d, subject: "mailto:test@example.org" } };
}

describe("VAPID", () => {
  it("signiert ein gültiges ES256-JWT mit aud, exp und sub", async () => {
    const { pair, cfg } = await vapidPair();
    const jwt = await vapidJwt(cfg, "https://web.push.apple.com", 1_800_000_000);
    const [h, b, s] = jwt.split(".");
    expect(JSON.parse(td.decode(b64uDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(td.decode(b64uDecode(b)))).toEqual({ aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600, sub: "mailto:test@example.org" });
    expect(b64uDecode(s).length).toBe(64);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64uDecode(s), te.encode(`${h}.${b}`))).toBe(true);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64uDecode(s), te.encode(`${h}.${b}x`))).toBe(false);
  });
  it("Audience ist nur der Ursprung, Header hat t= und k=", async () => {
    expect(audienceOf("https://web.push.apple.com/wpush/v2/abc?x=1")).toBe("https://web.push.apple.com");
    const { cfg } = await vapidPair();
    const h = await vapidAuthorization(cfg, "https://fcm.googleapis.com/fcm/send/xyz", 1_800_000_000);
    expect(h).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(h.endsWith(`k=${cfg.publicKey}`)).toBe(true);
  });
  it("lehnt einen kaputten öffentlichen Schlüssel ab", async () => {
    await expect(vapidJwt({ publicKey: "abc", privateKey: "x", subject: "mailto:a@b.c" }, "https://x.y")).rejects.toThrow();
  });
});

describe("Senden", () => {
  it("sendet verschlüsselt mit den richtigen Headern und gibt den Status zurück", async () => {
    const { cfg } = await vapidPair();
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPub = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
    const uaPriv = ((await crypto.subtle.exportKey("jwk", ua.privateKey)) as JsonWebKey).d!;
    const auth = b64uEncode(crypto.getRandomValues(new Uint8Array(16)));
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const status = await sendWebPush({ endpoint: "https://web.push.apple.com/wpush/v2/geheim", p256dh: b64uEncode(uaPub), auth }, { title: "Test", body: "Hallo", url: "/" }, cfg, { fetcher });
    expect(status).toBe(201);
    const h = seen!.init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.Authorization).toMatch(/^vapid t=/);
    expect(h.TTL).toBe("3600");
    const plain = td.decode(await decrypt(seen!.init.body as Uint8Array, uaPriv, b64uEncode(uaPub), auth));
    expect(JSON.parse(plain)).toEqual({ title: "Test", body: "Hallo", url: "/" });
  });
  it("meldet 0 bei Netzwerkfehler und reicht 410 durch", async () => {
    const { cfg } = await vapidPair();
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const sub = { endpoint: "https://web.push.apple.com/x", p256dh: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer)), auth: b64uEncode(new Uint8Array(16)) };
    const boom = (async () => { throw new Error("https://web.push.apple.com/x kaputt"); }) as unknown as typeof fetch;
    expect(await sendWebPush(sub, { title: "a", body: "b" }, cfg, { fetcher: boom })).toBe(0);
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect(await sendWebPush(sub, { title: "a", body: "b" }, cfg, { fetcher: gone })).toBe(410);
  });
});

/* ---------- Auswahl fälliger Erinnerungen ---------- */
// 2026-11-16 ist ein Montag, Winterzeit (UTC+1).
const at = (date: string, hm: string) => new Date(zoneLocalToUtcMs(date, +hm.slice(0, 2) * 60 + +hm.slice(3), "Europe/Zurich"));
const base = (now: Date, o: Partial<ReminderInput> = {}): ReminderInput => ({ now, sleepTime: "22:00", tasks: [], plans: [], trainingDoneToday: false, exams: [], ...o });
const task = (o: Partial<ReminderInput["tasks"][number]> = {}) => ({ id: "t1", title: "FRW lernen", dueDate: "2026-11-16", dueTime: "16:00", doneAt: null, parentId: null, ...o });

describe("Fällige Erinnerungen", () => {
  it("Aufgabe mit Uhrzeit: 10 Minuten vorher, nicht früher, nicht nach der Zeit", () => {
    const t = task();
    expect(dueReminders(base(at("2026-11-16", "15:49"), { tasks: [t] }))).toEqual([]);
    const r = dueReminders(base(at("2026-11-16", "15:50"), { tasks: [t] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "FRW lernen", key: "task:t1:2026-11-16:16:00" });
    expect(r[0].body).toBe("In 10 Minuten, 16:00");
    expect(dueReminders(base(at("2026-11-16", "15:59"), { tasks: [t] }))[0].body).toBe("In 1 Minute, 16:00");
    expect(dueReminders(base(at("2026-11-16", "16:00"), { tasks: [t] }))).toEqual([]);
  });
  it("Aufgabe: nicht wenn erledigt, ohne Uhrzeit, an anderem Tag oder als Unteraufgabe", () => {
    const now = at("2026-11-16", "15:55");
    expect(dueReminders(base(now, { tasks: [task({ doneAt: "2026-11-16T10:00:00Z" })] }))).toEqual([]);
    expect(dueReminders(base(now, { tasks: [task({ dueTime: null })] }))).toEqual([]);
    expect(dueReminders(base(now, { tasks: [task({ dueDate: "2026-11-17" })] }))).toEqual([]);
    expect(dueReminders(base(now, { tasks: [task({ parentId: "p" })] }))).toEqual([]);
  });
  it("Schlüssel ändert sich, wenn die Uhrzeit der Aufgabe geändert wird", () => {
    const a = dueReminders(base(at("2026-11-16", "15:55"), { tasks: [task()] }))[0].key;
    const b = dueReminders(base(at("2026-11-16", "16:25"), { tasks: [task({ dueTime: "16:30" })] }))[0].key;
    expect(a).not.toBe(b);
  });
  it("Training: Trainingstag 17:00, nur wenn offen, mit Nachfrist von einer Stunde", () => {
    const plans = [{ name: "Oberkörper", weekdays: [1, 3] }];
    expect(dueReminders(base(at("2026-11-16", "16:59"), { plans }))).toEqual([]);
    const r = dueReminders(base(at("2026-11-16", "17:00"), { plans }));
    expect(r).toMatchObject([{ title: "Training heute", body: "Oberkörper", key: "training:2026-11-16" }]);
    expect(dueReminders(base(at("2026-11-16", "17:59"), { plans }))).toHaveLength(1);
    expect(dueReminders(base(at("2026-11-16", "18:00"), { plans }))).toEqual([]);
    expect(dueReminders(base(at("2026-11-16", "17:00"), { plans, trainingDoneToday: true }))).toEqual([]);
    expect(dueReminders(base(at("2026-11-17", "17:00"), { plans }))).toEqual([]);
  });
  it("Prüfung: am Vorabend um 18:00, nur für morgen", () => {
    const exams = [{ id: "e1", date: "2026-11-17", startTime: "08:15", subjectCode: "FRW" }, { id: "e2", date: "2026-11-18", startTime: null, subjectCode: "E" }];
    expect(dueReminders(base(at("2026-11-16", "17:55"), { exams }))).toEqual([]);
    const r = dueReminders(base(at("2026-11-16", "18:00"), { exams }));
    expect(r).toMatchObject([{ title: "Prüfung morgen", body: "FRW, 08:15", key: "exam:e1" }]);
    expect(dueReminders(base(at("2026-11-17", "18:00"), { exams }))[0].body).toBe("E");
    expect(dueReminders(base(at("2026-11-16", "20:00"), { exams }))).toEqual([]);
  });
  it("Schlafen: 21:30, nur wenn heute noch etwas offen ist", () => {
    const open = [task({ dueTime: null })];
    expect(dueReminders(base(at("2026-11-16", "21:29"), { tasks: open }))).toEqual([]);
    const r = dueReminders(base(at("2026-11-16", "21:30"), { tasks: open }));
    expect(r).toMatchObject([{ title: "Schlafen um 22:00", key: "sleep:2026-11-16" }]);
    expect(dueReminders(base(at("2026-11-16", "21:30")))).toEqual([]);
    expect(dueReminders(base(at("2026-11-16", "21:30"), { tasks: [task({ dueTime: null, doneAt: "x" })] }))).toEqual([]);
    expect(dueReminders(base(at("2026-11-16", "22:00"), { tasks: open }))).toEqual([]);
    // Überfälliges zählt als offen, Zukünftiges nicht.
    expect(dueReminders(base(at("2026-11-16", "21:30"), { tasks: [task({ dueTime: null, dueDate: "2026-11-14" })] }))).toHaveLength(1);
    expect(dueReminders(base(at("2026-11-16", "21:30"), { tasks: [task({ dueTime: null, dueDate: "2026-11-17" })] }))).toEqual([]);
  });
  it("Schlafen: offenes Training zählt, andere Schlafenszeit verschiebt die Erinnerung", () => {
    const plans = [{ name: "Oberkörper", weekdays: [1] }];
    expect(dueReminders(base(at("2026-11-16", "21:30"), { plans }))).toHaveLength(1);
    expect(dueReminders(base(at("2026-11-16", "21:30"), { plans, sleepTime: "23:00" }))).toEqual([]);
    expect(dueReminders(base(at("2026-11-16", "22:30"), { plans, sleepTime: "23:00" }))[0].title).toBe("Schlafen um 23:00");
  });
  it("rechnet in Zürcher Zeit, auch im Sommer", () => {
    // Sommerzeit: 15:50 Uhr lokal ist 13:50 UTC.
    expect(dueReminders(base(at("2026-07-06", "15:50"), { tasks: [task({ dueDate: "2026-07-06" })] }))).toHaveLength(1);
  });
});
