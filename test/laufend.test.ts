import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { Account, Category, ImportResult, Transaction } from "../src/shared/schemas";
import { INTAKE_PATH, handleIntake } from "../src/server/eingang";
import { createWorker } from "../src/server/mcp/worker";
import type { McpEnv } from "../src/server/mcp/env";

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}

const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-10-02 12:30:00,2026-10-02 12:30:00,Pizzeria Roma Zuerich,-24.00,0.00,CHF,COMPLETED,476.00
CARD_PAYMENT,Current,2026-10-03 10:00:00,2026-10-03 10:00:00,Testkiosk Hauptbahnhof,-4.50,0.00,CHF,COMPLETED,471.50
CARD_PAYMENT,Current,2026-10-20 10:00:00,2026-10-20 10:00:00,Bahn Billett,-9.00,0.00,CHF,COMPLETED,462.50
`;

describe("vorläufige Buchungen und Abgleich beim Import", () => {
  it("ordnet zu, übernimmt Kategorie und Mahlzeit, lässt Unpassendes stehen und setzt den Ankersaldo", async () => {
    const acc = (await call<Account>("POST", "/api/accounts", { name: "Revolut" })).data;
    const cats = (await call<Category[]>("GET", "/api/categories")).data;
    const sonst = (await call<Category>("POST", "/api/categories", { name: "Sonstiges" })).data;
    const ea = (await call<Category>("POST", "/api/categories", { name: "Essen auswärts" })).data;
    void cats;
    const mk = (merchant: string, amount: number, date: string, categoryId?: string) => call<{ id: string }>("POST", "/api/provisional", { accountId: acc.id, merchant, amount, date, categoryId });
    const pizza = (await mk("Pizzeria Roma", 24, "2026-10-02", ea.id)).data.id;
    const kiosk = (await mk("Testkiosk", 4.5, "2026-10-04", sonst.id)).data.id;
    const trinkgeld = (await mk("Restaurant Sonne", 20, "2026-10-10")).data.id;
    const spaet = (await mk("Neu im November", 8, "2026-11-12")).data.id;

    const before = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data;
    expect(before.filter((t) => t.state === "provisional")).toHaveLength(4);
    expect(before.find((t) => t.id === pizza)).toMatchObject({ amount: -24, state: "provisional", origin: "hand", mealOut: true });

    const imp = await call<ImportResult>("POST", "/api/import/commit", { files: [{ name: "revolut.csv", text: REVOLUT }] });
    expect(imp.status).toBe(201);
    expect(imp.data.inserted).toBe(3);
    expect(imp.data.matched).toBe(2);

    const after = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data;
    expect(after.find((t) => t.id === pizza)).toBeUndefined();
    expect(after.find((t) => t.id === kiosk)).toBeUndefined();
    expect(after.find((t) => t.id === trinkgeld)?.state).toBe("provisional");
    expect(after.find((t) => t.id === spaet)?.state).toBe("provisional");
    const piz = after.find((t) => t.description?.startsWith("Pizzeria"))!;
    expect(piz).toMatchObject({ state: "confirmed", origin: "auszug", categoryId: ea.id, mealOut: true });
    expect(after.find((t) => t.description?.startsWith("Testkiosk"))).toMatchObject({ state: "confirmed", categoryId: sonst.id });

    const accs = (await call<Account[]>("GET", "/api/accounts")).data;
    const rev = accs.find((a) => a.id === acc.id)!;
    expect(rev).toMatchObject({ anchorBalance: 462.5, anchorDay: "2026-10-20", anchorKind: "auszug", coveredThrough: "2026-10-20" });

    // Zweiter Upload derselben Datei: nichts mehr zuzuordnen, nichts doppelt
    const again = await call<ImportResult>("POST", "/api/import/commit", { files: [{ name: "revolut.csv", text: REVOLUT }] });
    expect(again.data.inserted).toBe(0);
    expect(again.data.matched ?? 0).toBe(0);
    expect((await call<Transaction[]>("GET", "/api/transactions?limit=100")).data.filter((t) => t.state === "provisional")).toHaveLength(2);
  });

  it("löscht nur vorläufige Buchungen", async () => {
    const accs = (await call<Account[]>("GET", "/api/accounts")).data;
    const all = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data;
    const conf = all.find((t) => t.state === "confirmed")!;
    const prov = all.find((t) => t.state === "provisional")!;
    expect((await call("DELETE", `/api/transactions/${conf.id}`)).status).toBe(409);
    expect((await call("DELETE", `/api/transactions/${prov.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/transactions/${prov.id}`)).status).toBe(404);
    const left = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data;
    expect(left.some((t) => t.id === conf.id)).toBe(true);
    expect(accs.length).toBeGreaterThan(0);
  });

  it("prüft die Eingabe von Hand streng", async () => {
    const acc = (await call<Account[]>("GET", "/api/accounts")).data[0]!;
    const ok = { accountId: acc.id, merchant: "Kiosk", amount: 3, date: "2026-11-01" };
    expect((await call("POST", "/api/provisional", { ...ok, amount: -3 })).status).toBe(400);
    expect((await call("POST", "/api/provisional", { ...ok, amount: 0 })).status).toBe(400);
    expect((await call("POST", "/api/provisional", { ...ok, merchant: "  " })).status).toBe(400);
    expect((await call("POST", "/api/provisional", { ...ok, merchant: "x".repeat(121) })).status).toBe(400);
    expect((await call("POST", "/api/provisional", { ...ok, accountId: "gibt-es-nicht" })).status).toBe(400);
    expect((await call("POST", "/api/provisional", { ...ok, date: "heute" })).status).toBe(400);
    expect((await call("POST", "/api/provisional", ok)).status).toBe(201);
  });
});

describe("Kontostand abgleichen", () => {
  it("rechnet Anker plus Buchungen gegen die Eingabe und bucht die Differenz als Sammelbuchung", async () => {
    const acc = (await call<Account[]>("GET", "/api/accounts")).data.find((a) => a.name === "Revolut")!;
    // Anker ist der Auszugssaldo 462.50 vom 20.10. Alle vorläufigen zählen, spätere bestätigte auch (keine).
    const prov = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data.filter((t) => t.state === "provisional");
    const sum = prov.reduce((s, t) => s + t.amount, 0);
    const expected = Math.round((462.5 + sum) * 100) / 100;
    const r = await call<{ state: string; expected: number; diff: number; unrecorded: number }>("PUT", `/api/accounts/${acc.id}/balance`, { balance: expected - 30 });
    expect(r.data).toMatchObject({ state: "differenz", expected, diff: -30, unrecorded: 30 });
    const book = await call<{ id: string }>("POST", `/api/accounts/${acc.id}/unrecorded`);
    expect(book.status).toBe(201);
    const row = (await call<Transaction[]>("GET", "/api/transactions?limit=100")).data.find((t) => t.id === book.data.id)!;
    expect(row).toMatchObject({ amount: -30, description: "Nicht erfasst", state: "provisional", origin: "hand" });
    // Danach stimmt die Rechnung
    const again = await call<{ state: string; unrecorded: number }>("PUT", `/api/accounts/${acc.id}/balance`, { balance: expected - 30 });
    expect(again.data).toMatchObject({ state: "stimmt", unrecorded: 0 });
    expect((await call("POST", `/api/accounts/${acc.id}/unrecorded`)).status).toBe(409);
  });

  it("die erste Eingabe wird zum Anker, wenn es noch keinen Auszugssaldo gibt", async () => {
    const acc = (await call<Account>("POST", "/api/accounts", { name: "Yuh" })).data;
    const r = await call<{ state: string }>("PUT", `/api/accounts/${acc.id}/balance`, { balance: 100 });
    expect(r.data.state).toBe("keine-eingabe");
    const a = (await call<Account[]>("GET", "/api/accounts")).data.find((x) => x.id === acc.id)!;
    expect(a).toMatchObject({ anchorBalance: 100, anchorKind: "eingabe", enteredBalance: 100 });
    expect((await call("PUT", `/api/accounts/${acc.id}/balance`, { balance: "viel" })).status).toBe(400);
    expect((await call("PUT", "/api/accounts/gibt-es-nicht/balance", { balance: 1 })).status).toBe(404);
  });
});

/* ---------- Eingangsroute ---------- */
const URL_ = "https://dashboard.hahntim518.workers.dev" + INTAKE_PATH;
const post = (body: unknown, key?: string, nowMs?: number, raw = false) =>
  handleIntake(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: raw ? (body as string) : JSON.stringify(body) }), env, nowMs);
const countProv = async () => (await env.DB.prepare("select count(*) n from transactions where origin='kurzbefehl'").first<{ n: number }>())!.n;
const clearLog = () => env.DB.prepare("delete from intake_log").run();
const runs = async () => (await env.DB.prepare("select ok, message from sync_runs where kind='kurzbefehl' order by at, rowid").all<{ ok: number; message: string }>()).results;

describe("POST /eingang/buchung", () => {
  let key = "";
  let t0 = Date.parse("2026-11-15T10:00:00Z");
  const next = () => (t0 += 130_000); // jede Anfrage in einem neuen Doppel-Fenster

  it("ist ohne Schlüssel in der Datenbank nicht vorhanden (404), auch mit Bearer-Header und für jede Methode", async () => {
    expect((await post({ merchant: "Kiosk", amount: 5 }, "A".repeat(43))).status).toBe(404);
    for (const method of ["GET", "PUT", "DELETE"]) expect((await handleIntake(new Request(URL_, { method }), env)).status).toBe(404);
    expect(await countProv()).toBe(0);
  });

  it("Schlüssel erzeugen: 43 Zeichen base64url, in der Datenbank nur als Hash", async () => {
    const r = await call<{ key: string }>("POST", "/api/eingang/schluessel");
    expect(r.status).toBe(201);
    key = r.data.key;
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = (await env.DB.prepare("select hash from intake_keys").all<{ hash: string }>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.hash).not.toContain(key);
    // Nirgends sonst im Klartext: weder in Einstellungen noch im Export
    expect(JSON.stringify((await call("GET", "/api/settings")).data)).not.toContain(key);
    expect(JSON.stringify((await call("GET", "/api/export")).data)).not.toContain(key);
    expect((await call<{ active: boolean; lastAt: string | null }>("GET", "/api/eingang")).data).toMatchObject({ active: true, lastAt: null });
  });

  it("legt eine vorläufige Buchung an und antwortet nur mit ok", async () => {
    const res = await post({ merchant: "Coop Pronto Zürich", amount: "CHF 12.50", card: "Revolut Visa" }, key, next());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await env.DB.prepare("select * from transactions where origin='kurzbefehl'").first<Record<string, unknown>>();
    expect(row).toMatchObject({ amount: -12.5, currency: "CHF", state: "provisional", origin: "kurzbefehl", description: "Coop Pronto Zürich", hash: null });
    expect(row!.category_id).toBeTruthy();
    const acc = await env.DB.prepare("select name from accounts where id = ?").bind(row!.account_id).first<{ name: string }>();
    expect(acc!.name).toBe("Revolut");
    const lastRun = (await runs()).at(-1)!;
    expect(lastRun).toEqual({ ok: 1, message: "Buchung gespeichert" });
    expect((await call<{ lastAt: string | null }>("GET", "/api/eingang")).data.lastAt).toBeTruthy();
  });

  it("sync_runs und Protokoll enthalten nie Händler oder Betrag", async () => {
    for (const r of await runs()) expect(r.message).not.toMatch(/Coop|12|Kiosk/);
    const log = JSON.stringify((await env.DB.prepare("select * from intake_log").all()).results);
    expect(log).not.toMatch(/Coop|12\.5/);
  });

  it("Kategorie und Mahlzeit über die vorhandenen Regeln", async () => {
    await call("POST", "/api/categories", { name: "Gastronomie" });
    await post({ merchant: "Restaurant Sonne", amount: 36 }, key, next());
    await post({ merchant: "Starbucks", amount: 4.8 }, key, next());
    const r = (await env.DB.prepare("select t.description d, t.meal_out m, c.name c from transactions t left join categories c on c.id=t.category_id where origin='kurzbefehl'").all<{ d: string; m: number; c: string }>()).results;
    expect(r.find((x) => x.d === "Restaurant Sonne")).toMatchObject({ c: "Gastronomie", m: 1 });
    expect(r.find((x) => x.d === "Starbucks")).toMatchObject({ c: "Gastronomie", m: 0 }); // unter 10 Franken: Snack
  });

  it("falscher oder fehlender Schlüssel: 401 ohne Hinweis, nichts angelegt", async () => {
    const n = await countProv();
    for (const k of [undefined, "A".repeat(43), "kurz", key + "x", key.slice(0, -1) + (key.endsWith("A") ? "B" : "A")]) {
      const res = await post({ merchant: "Kiosk", amount: 5 }, k, next());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    const basic = await handleIntake(new Request(URL_, { method: "POST", headers: { authorization: `Basic ${key}` }, body: "{}" }), env, next());
    expect(basic.status).toBe(401);
    expect(await countProv()).toBe(n);
    expect((await runs()).filter((r) => r.message === "Schlüssel falsch").length).toBe(6);
  });

  it("prüft den Inhalt streng", async () => {
    const n = await countProv();
    const bad: unknown[] = [
      { merchant: "", amount: 5 }, { merchant: "   ", amount: 5 }, { merchant: "x".repeat(121), amount: 5 }, { amount: 5 }, { merchant: "A" },
      { merchant: "A", amount: 0 }, { merchant: "A", amount: -5 }, { merchant: "A", amount: "-5" }, { merchant: "A", amount: 5000.01 }, { merchant: "A", amount: "CHF 5001" },
      { merchant: "A", amount: "abc" }, { merchant: "A", amount: null }, { merchant: "A", amount: [5] }, { merchant: "A", amount: { v: 5 } }, { merchant: 5, amount: 5 },
      { merchant: "A", amount: 5, extra: 1 }, { merchant: "A", amount: 5, currency: "FRANKEN" }, { merchant: "A", amount: "CHF 5", currency: "EUR" },
      { merchant: "A", amount: 5, at: "gestern" }, { merchant: "A", amount: 5, at: "2020-01-01T00:00:00Z" }, { merchant: "A", amount: 5, at: "2030-01-01T00:00:00Z" },
      [], "text", 5, null,
    ];
    for (const b of bad) expect((await post(b, key, next())).status, JSON.stringify(b)).toBe(400);
    for (const raw of ["", "{", "nicht json", "{\"merchant\": \"A\", \"amount\": 5"]) expect((await post(raw, key, next(), true)).status).toBe(400);
    expect(await countProv()).toBe(n);
    const toolarge = await post({ merchant: "A", amount: 5, card: "x".repeat(8000) }, key, next());
    expect(toolarge.status).toBe(413);
  });

  it("nimmt Grenzfälle an: 5000 Franken, Text- und Zahlformate, Währung, Zeitpunkt", async () => {
    const n = await countProv();
    for (const amount of [5000, "5000.00", "CHF 5'000.00", "Fr. 7.50", "7,50 CHF", 7.5, "€ 3,20"]) {
      expect((await post({ merchant: `Test ${amount}`, amount }, key, next())).status, String(amount)).toBe(200);
    }
    expect((await post({ merchant: "Bar Roma", amount: "10", currency: "eur" }, key, next())).status).toBe(200);
    const now = t0 + 130_000;
    expect((await post({ merchant: "Gestern", amount: 3, at: new Date(now - 86400_000).toISOString() }, key, now)).status).toBe(200);
    expect(await countProv()).toBe(n + 9);
    const eur = await env.DB.prepare("select currency, amount from transactions where description='Bar Roma'").first<{ currency: string; amount: number }>();
    expect(eur).toEqual({ currency: "EUR", amount: -10 });
    const alt = await env.DB.prepare("select date from transactions where description='Gestern'").first<{ date: string }>();
    expect(alt!.date).toBe("2026-11-14");
  });

  it("Händlername wird gesäubert und bleibt Text", async () => {
    await post({ merchant: "  Bäckerei\n\u0000<b>Müller</b>  ", amount: 6 }, key, next());
    const r = await env.DB.prepare("select description d from transactions where description like '%ckerei%'").first<{ d: string }>();
    expect(r!.d).toBe("Bäckerei <b>Müller</b>");
  });

  it("Doppel-Schutz: gleicher Händler, Betrag und Konto innerhalb von 2 Minuten zählt einmal", async () => {
    const base = (t0 += 10_000_000);
    const n = await countProv();
    expect((await post({ merchant: "Doppel Kiosk", amount: 4.2 }, key, base)).status).toBe(200);
    expect((await post({ merchant: "doppel  kiosk", amount: "CHF 4.20" }, key, base + 60_000)).status).toBe(200);
    expect((await post({ merchant: "Doppel Kiosk", amount: 4.2 }, key, base + 119_000)).status).toBe(200);
    expect(await countProv()).toBe(n + 1);
    expect((await runs()).filter((r) => r.message === "Doppel ignoriert").length).toBeGreaterThanOrEqual(2);
    // anderer Betrag, anderer Händler: neue Buchung
    await post({ merchant: "Doppel Kiosk", amount: 4.3 }, key, base + 30_000);
    await post({ merchant: "Anderer Kiosk", amount: 4.2 }, key, base + 31_000);
    expect(await countProv()).toBe(n + 3);
    // nach mehr als 2 Minuten (und neuem Fenster) zählt es wieder
    await post({ merchant: "Doppel Kiosk", amount: 4.2 }, key, base + 3 * 120_000);
    expect(await countProv()).toBe(n + 4);
  });

  it("gleichzeitige gleiche Anfragen ergeben eine Buchung", async () => {
    const base = (t0 += 10_000_000);
    const n = await countProv();
    await clearLog();
    const rs = await Promise.all(Array.from({ length: 5 }, () => post({ merchant: "Parallel Kiosk", amount: 8.8 }, key, base)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await countProv()).toBe(n + 1);
  });

  it("Rate-Limit: 10 pro Minute und 60 pro Tag, danach 429 ohne neue Buchung", async () => {
    await clearLog();
    const base = (t0 += 10_000_000);
    const n = await countProv();
    for (let i = 0; i < 10; i++) expect((await post({ merchant: `Limit ${i}`, amount: 1 + i }, key, base + i * 1000)).status).toBe(200);
    const eleventh = await post({ merchant: "Limit 11", amount: 99 }, key, base + 10_000);
    expect(eleventh.status).toBe(429);
    expect(await countProv()).toBe(n + 10);
    // eine Minute später wieder frei
    expect((await post({ merchant: "Limit später", amount: 2 }, key, base + 70_000)).status).toBe(200);
    // Tageslimit: 60 Anfragen in 24 Stunden, auf die Stunde verteilt
    await clearLog();
    const day = (t0 += 10_000_000);
    const rows = Array.from({ length: 59 }, (_, i) => `('l${i}', '${new Date(day - 60_000 - i * 1000).toISOString()}', 'auth')`).join(",");
    await env.DB.prepare(`insert into intake_log (id, at, kind) values ${rows}`).run();
    expect((await post({ merchant: "Tag 60", amount: 3 }, key, day)).status).toBe(200);
    expect((await post({ merchant: "Tag 61", amount: 4 }, key, day + 61_000)).status).toBe(429);
    // ein Tag später wieder frei
    expect((await post({ merchant: "Neuer Tag", amount: 5 }, key, day + 25 * 3600_000)).status).toBe(200);
  });

  it("nach 20 Fehlversuchen pro Stunde gesperrt, auch für den richtigen Schlüssel; danach wieder frei", async () => {
    await clearLog();
    const base = (t0 += 10_000_000);
    const n = await countProv();
    for (let i = 0; i < 20; i++) expect((await post({ merchant: "X", amount: 5 }, "B".repeat(43), base + i * 100)).status).toBe(401);
    const locked = await post({ merchant: "Gesperrt", amount: 5 }, key, base + 3000);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "gesperrt" });
    expect((await post({ merchant: "X", amount: 5 }, "B".repeat(43), base + 4000)).status).toBe(429);
    expect(await countProv()).toBe(n);
    const failRows = (await env.DB.prepare("select count(*) n from intake_log where kind='fail'").first<{ n: number }>())!.n;
    expect(failRows).toBe(20); // während der Sperre wird nichts mehr geschrieben
    expect((await call<{ locked: boolean }>("GET", "/api/eingang")).data.locked).toBe(true);
    expect((await post({ merchant: "Wieder frei", amount: 5 }, key, base + 3601_000)).status).toBe(200);
  });

  it("widerrufen: danach ist die Route weg, ein neuer Schlüssel macht den alten ungültig", async () => {
    await clearLog();
    const old = key;
    const fresh = (await call<{ key: string }>("POST", "/api/eingang/schluessel")).data.key;
    expect(fresh).not.toBe(old);
    expect((await post({ merchant: "Alt", amount: 5 }, old, (t0 += 10_000_000))).status).toBe(401);
    await clearLog();
    expect((await post({ merchant: "Neu", amount: 5 }, fresh, (t0 += 10_000_000))).status).toBe(200);
    expect((await call("DELETE", "/api/eingang/schluessel")).status).toBe(200);
    expect((await post({ merchant: "Weg", amount: 5 }, fresh, (t0 += 10_000_000))).status).toBe(404);
    expect((await call<{ active: boolean }>("GET", "/api/eingang")).data.active).toBe(false);
    key = (await call<{ key: string }>("POST", "/api/eingang/schluessel")).data.key;
    await clearLog();
  });

  it("legt kein unbekanntes Konto an: ohne passendes Konto 422", async () => {
    await call("PUT", "/api/settings", { eingangKonto: "Gibt es nicht" });
    const accountsBefore = (await env.DB.prepare("select count(*) n from accounts").first<{ n: number }>())!.n;
    const n = await countProv();
    expect((await post({ merchant: "Kiosk", amount: 5 }, key, (t0 += 10_000_000))).status).toBe(422);
    expect(await countProv()).toBe(n);
    expect((await env.DB.prepare("select count(*) n from accounts").first<{ n: number }>())!.n).toBe(accountsBefore);
    const test = await call<{ ok: boolean; reason?: string }>("POST", "/api/eingang/test");
    expect(test.data).toEqual({ ok: false, reason: "konto" });
    await call("PUT", "/api/settings", { eingangKonto: "Yuh" });
    await post({ merchant: "Auf Yuh", amount: 5 }, key, (t0 += 10_000_000));
    const row = await env.DB.prepare("select a.name n from transactions t join accounts a on a.id=t.account_id where t.description='Auf Yuh'").first<{ n: string }>();
    expect(row!.n).toBe("Yuh");
    await call("PUT", "/api/settings", { eingangKonto: "Revolut" });
  });

  it("mehrere Karten: der Kartenname aus Wallet wählt das Konto, sonst gilt das Standardkonto", async () => {
    await call("POST", "/api/accounts", { name: "ZKB" });
    const cases: [string, string][] = [["ZKB Debit Mastercard", "ZKB"], ["Yuh Mastercard", "Yuh"], ["revolut VISA", "Revolut"], ["Unbekannte Karte", "Revolut"], ["ZKB Yuh", "Revolut"]];
    for (const [i, [card, want]] of cases.entries()) {
      await post({ merchant: `Karte ${i}`, amount: 3 + i, card }, key, (t0 += 10_000_000));
      const row = await env.DB.prepare("select a.name n from transactions t join accounts a on a.id=t.account_id where t.description=?").bind(`Karte ${i}`).first<{ n: string }>();
      expect(row!.n, card).toBe(want);
    }
  });

  it("Test aus der App legt keine Buchung an", async () => {
    const n = await countProv();
    const total = (await env.DB.prepare("select count(*) n from transactions").first<{ n: number }>())!.n;
    const r = await call<{ ok: boolean; account: string }>("POST", "/api/eingang/test");
    expect(r.data).toMatchObject({ ok: true, account: "Revolut" });
    expect(await countProv()).toBe(n);
    expect((await env.DB.prepare("select count(*) n from transactions").first<{ n: number }>())!.n).toBe(total);
  });

  it("über den echten Worker: ohne Access-Anmeldung erreichbar, alles andere bleibt gesperrt", async () => {
    // Ohne ALLOW_LOCAL_NOAUTH und mit öffentlicher Adresse, wie in Produktion
    const prod = { ...env, ALLOW_LOCAL_NOAUTH: undefined, OWNER_EMAIL: "tim@example.com" } as unknown as McpEnv;
    const w = createWorker();
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    await clearLog();
    const ok = await w.fetch(new Request(URL_, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ merchant: "Über Worker", amount: 2.5 }) }), prod, ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    for (const path of ["/api/transactions", "/api/eingang", "/api/eingang/schluessel", "/eingang/buchung/x", "/eingang"]) {
      const r = await w.fetch(new Request("https://dashboard.hahntim518.workers.dev" + path, { method: path === "/api/eingang/schluessel" ? "POST" : "GET", headers: { authorization: `Bearer ${key}` } }), prod, ctx);
      expect([401, 403, 404], path).toContain(r.status);
      expect(r.status === 200, path).toBe(false);
    }
    const bad = await w.fetch(new Request(URL_, { method: "POST", headers: { authorization: `Bearer ${"C".repeat(43)}` }, body: "{}" }), prod, ctx);
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "unauthorized" });
    // Die Route fasst nichts ausser vorläufigen Buchungen an
    const written = (await env.DB.prepare("select count(*) n from transactions where origin='kurzbefehl' and state='provisional'").first<{ n: number }>())!.n;
    expect(written).toBe(await countProv());
  });
});
