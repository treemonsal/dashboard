import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { sendDueReminders } from "../src/server/push";
import { runScheduled } from "../src/server/cron";
import { b64uEncode } from "../src/server/webpush";
import { addDays, clockOf, todayInZone, zoneLocalToUtcMs } from "../src/shared/dates";

async function call(method: string, path: string, body?: unknown) {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}

async function newSub(name: string) {
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { endpoint: `https://push.example/${name}`, keys: { p256dh: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer)), auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))) } };
}
async function vapid() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKey: b64uEncode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)), privateKey: ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d!, subject: "mailto:t@example.org" };
}

describe("sendDueReminders", () => {
  it("sendet jede Erinnerung höchstens einmal, an alle Abos, und löscht abgelaufene", async () => {
    const today = todayInZone();
    const now = new Date(zoneLocalToUtcMs(today, 15 * 60 + 52, "Europe/Zurich"));
    await call("POST", "/api/tasks", { id: "er-1", title: "Lernen", dueDate: today, dueTime: "16:00" });
    const good = await newSub("gut");
    const gone = await newSub("weg");
    await call("POST", "/api/push/subscribe", good);
    await call("POST", "/api/push/subscribe", gone);

    const cfg = await vapid();
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: url.endsWith("/weg") ? 410 : 201 });
    }) as unknown as typeof fetch;

    // Ohne Schlüssel: nichts.
    expect(await sendDueReminders(env, { now })).toEqual({ due: 0, sent: 0, removed: 0 });

    const r1 = await sendDueReminders(env, { now, vapid: cfg, fetcher });
    expect(r1).toMatchObject({ due: 1, sent: 1, removed: 1 });
    expect(urls.sort()).toEqual(["https://push.example/gut", "https://push.example/weg"]);
    expect((await call("GET", "/api/push/status")).data.count).toBe(1);

    // Zweiter Lauf zwei Minuten später: schon gesendet.
    urls.length = 0;
    const r2 = await sendDueReminders(env, { now: new Date(now.getTime() + 120_000), vapid: cfg, fetcher });
    expect(r2).toMatchObject({ due: 1, sent: 0 });
    expect(urls).toEqual([]);
    await call("POST", "/api/push/unsubscribe", { endpoint: good.endpoint });
  });

  it("Cron-Lauf fängt Fehler ab und wirft nicht", async () => {
    await expect(runScheduled(env, new Date())).resolves.toBeUndefined();
    expect(clockOf(0)).toBe("00:00");
    expect(addDays(todayInZone(), 0)).toBe(todayInZone());
  });
});
