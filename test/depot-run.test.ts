import { beforeEach, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/server/db/schema";
import { depotDue, updateDepot } from "../src/server/depot/run";
import { tradegate, cboe, frankfurter, type FxSource, type PriceSource } from "../src/server/depot/kurse";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-11-17T22:30:00Z"); // 23:30 in Zürich, Dienstag
const closes = (rows: [string, number][]) => rows.map(([date, close]) => ({ date, close }));
const price = (map: Record<string, [string, number][]>): PriceSource => ({ name: "t", closes: async (s) => closes(map[s] ?? []) });
const fx = (rows: [string, number][]): FxSource => ({ name: "t", rates: async () => closes(rows) });
const SPY: [string, number][] = [["2026-11-12", 100], ["2026-11-13", 110], ["2026-11-16", 99], ["2026-11-17", 121]];
const hand = (date: string, amount: number) => env.DB.prepare("INSERT INTO investment_entries (id,kind,date,amount) VALUES (?,?,?,?)").bind(crypto.randomUUID(), "value", date, amount).run();
const rows = async () => (await db.select().from(schema.investmentEntries).all()).sort((a, b) => a.date.localeCompare(b.date));
const runs = async () => (await db.select().from(schema.syncRuns).all()).filter((r) => r.kind === "depot");

beforeEach(async () => {
  for (const t of ["investment_entries", "sync_runs", "settings", "depot_buys"]) await env.DB.exec(`DELETE FROM ${t}`);
  await env.DB.exec("INSERT INTO settings (key,value) VALUES ('investHoldings','[]')");
});

describe("Depotlauf", () => {
  it("ohne Startwert: nichts schreiben, nicht abrufen", async () => {
    const r = await updateDepot(env, { now: NOW, price: price({}), fx: fx([]) });
    expect(r.added).toBe(0);
    expect((await rows())).toHaveLength(0);
    expect((await runs())).toHaveLength(1);
  });
  it("schreibt Schätzungen fort, lässt den Handwert unberührt, ist wiederholbar", async () => {
    await hand("2026-11-12", 1000);
    const o = { now: NOW, price: price({ SPY }), fx: fx([["2026-11-01", 1]]) };
    const r = await updateDepot(env, o);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(3);
    await updateDepot(env, o);
    const all = (await rows());
    expect(all.map((x) => [x.date, x.amount, x.estimated])).toEqual([["2026-11-12", 1000, false], ["2026-11-13", 1100, true], ["2026-11-16", 990, true], ["2026-11-17", 1210, true]]);
    expect((await runs())).toHaveLength(2);
    expect((await runs()).every((x) => x.ok)).toBe(true);
  });
  it("Quelle nicht erreichbar: kein neuer Wert, Lauf als Fehler vermerkt", async () => {
    await hand("2026-11-12", 1000);
    const r = await updateDepot(env, { now: NOW, price: price({}), fx: fx([["2026-11-01", 1]]) });
    expect(r.ok).toBe(false);
    expect((await rows())).toHaveLength(1);
    expect((await runs())[0]!.ok).toBe(false);
  });
  it("Wochenende: kein neuer Kurs, nichts Neues, kein Fehler", async () => {
    await hand("2026-11-13", 1000);
    const r = await updateDepot(env, { now: new Date("2026-11-14T22:30:00Z"), price: price({ SPY: SPY.slice(0, 2) }), fx: fx([["2026-11-01", 1]]) });
    expect(r).toMatchObject({ ok: true, added: 0 });
    expect((await rows())).toHaveLength(1);
  });
  it("genaue Rechnung mit Anteilen: nicht als geschätzt gekennzeichnet, mit Wechselkurs", async () => {
    await hand("2026-11-12", 1000);
    await env.DB.exec("DELETE FROM settings WHERE key='investHoldings'");
    await env.DB.exec("INSERT INTO settings (key,value) VALUES ('investSymbol','VOO'),('investShares','2'),('investCurrency','USD')");
    const r = await updateDepot(env, { now: NOW, price: price({ SPY, VOO: closes([["2026-11-13", 500], ["2026-11-16", 400]]).map((c) => [c.date, c.close] as [string, number]) }), fx: fx([["2026-11-01", 0.8]]) });
    expect(r.added).toBe(2);
    expect((await rows()).map((x) => [x.date, x.amount, x.estimated, x.note])).toEqual([["2026-11-12", 1000, false, null], ["2026-11-13", 800, false, "auto"], ["2026-11-16", 640, false, "auto"]]);
  });
  it("ein später eingetragener Handwert desselben Tages bleibt, der Lauf überschreibt ihn nie", async () => {
    await hand("2026-11-12", 1000);
    await hand("2026-11-13", 1234);
    await updateDepot(env, { now: NOW, price: price({ SPY }), fx: fx([["2026-11-01", 1]]) });
    expect((await rows()).find((x) => x.date === "2026-11-13")).toMatchObject({ amount: 1234, estimated: false });
  });
  it("ISIN statt Kürzel: klare Meldung, nichts geschrieben", async () => {
    await hand("2026-11-12", 1000);
    await env.DB.exec("DELETE FROM settings WHERE key='investHoldings'");
    await env.DB.exec("INSERT INTO settings (key,value) VALUES ('investSymbol','IE00B5BMR087'),('investShares','2')");
    const r = await updateDepot(env, { now: NOW, price: price({ SPY }), fx: fx([["2026-11-01", 1]]) });
    expect(r.ok).toBe(false);
    expect((await rows())).toHaveLength(1);
  });
});

describe("Depot: Zeitpunkt und Routen", () => {
  it("einmal pro Tag ab 23:00, nach Fehler nach 55 Minuten wieder", async () => {
    expect(await depotDue(env, new Date("2026-11-17T21:30:00Z"))).toBe(false); // 22:30
    expect(await depotDue(env, NOW)).toBe(true);
    await db.insert(schema.syncRuns).values({ id: "a", kind: "depot", ok: false, at: NOW.toISOString() });
    expect(await depotDue(env, new Date(NOW.getTime() + 20 * 60_000))).toBe(false);
    expect(await depotDue(env, new Date(NOW.getTime() + 56 * 60_000))).toBe(false); // 00:26 am nächsten Tag: vor 23:00
    await env.DB.exec("DELETE FROM sync_runs");
    await db.insert(schema.syncRuns).values({ id: "b", kind: "depot", ok: true, at: NOW.toISOString() });
    expect(await depotDue(env, new Date(NOW.getTime() + 20 * 60_000))).toBe(false);
  });
  it("Handwert über die Route ersetzt die Zeile des Laufs vom selben Tag, nur diese", async () => {
    await env.DB.exec("INSERT INTO investment_entries (id,kind,date,amount,estimated,note) VALUES ('e1','value','2026-11-13',5,1,'Schätzung'),('e2','value','2026-11-14',6,1,'Schätzung')");
    const res = await exports.default.fetch(new Request("http://localhost/api/invest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "value", date: "2026-11-13", amount: 3175 }) }));
    expect(res.status).toBe(201);
    expect((await rows()).map((x) => [x.date, x.amount, x.estimated])).toEqual([["2026-11-13", 3175, false], ["2026-11-14", 6, true]]);
  });
});

describe("Kursquellen", () => {
  it("Cboe: Antwort lesen, Müll und Fehler ergeben eine leere Liste", async () => {
    const ok = async () => new Response(JSON.stringify({ symbol: "SPY", data: [{ date: "2026-11-13", close: 757.1 }, { date: "x", close: 1 }, { date: "2026-11-12", close: -3 }, { date: "2026-10-01", close: 700 }] }));
    expect(await cboe.closes("SPY", "2026-11-01", ok as never)).toEqual([{ date: "2026-11-13", close: 757.1 }]);
    expect(await cboe.closes("SPY", "2026-11-01", (async () => new Response("nope", { status: 500 })) as never)).toEqual([]);
    expect(await cboe.closes("SPY", "2026-11-01", (async () => { throw new Error("netz"); }) as never)).toEqual([]);
    expect(await cboe.closes("../x?", "2026-11-01", ok as never)).toEqual([]);
  });
  it("Frankfurter: Antwort lesen, Fehler ergeben eine leere Liste", async () => {
    const ok = async () => new Response(JSON.stringify([{ date: "2026-11-13", base: "USD", quote: "CHF", rate: 0.83 }, { date: "2026-11-12", rate: "x" }]));
    expect(await frankfurter.rates("USD", "2026-11-01", ok as never)).toEqual([{ date: "2026-11-13", close: 0.83 }]);
    expect(await frankfurter.rates("USD", "2026-11-01", (async () => new Response("{}", { status: 429 })) as never)).toEqual([]);
  });
});


describe("Mehrere ETF: Quellen und Lauf", () => {
  it("Tradegate liest nur den ISIN passenden abgeschlossenen EUR Handelstag", async () => {
    const html = '<meta name="description" content="Tradegate BSX, IE00BFMXXD54, Vanguard"><strong id="last">132,915</strong><span id="rt_datum">13.11.2026</span><span id="rt_zeit">22:00:00</span>Kurse in EUR';
    expect(await tradegate.closes("IE00BFMXXD54", "2026-11-01", (async () => new Response(html)) as never, new Date("2026-11-14T10:00:00Z"))).toEqual([{ date: "2026-11-13", close: 132.915 }]);
    expect(await tradegate.closes("IE00BMFKG444", "2026-11-01", (async () => new Response(html)) as never, new Date("2026-11-14T10:00:00Z"))).toEqual([]);
    expect(await tradegate.closes("IE00BFMXXD54", "2026-11-01", (async () => new Response(html)) as never, new Date("2026-11-13T12:00:00Z"))).toEqual([]);
  });
  it("berechnet beide Positionen ohne Abhängigkeit von SPY", async () => {
    await hand("2026-11-12", 1000);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('investHoldings',?)").bind(JSON.stringify([{ symbol: "VUAA", exchange: "TRADEGATE", shares: 2 }, { symbol: "XNAS", exchange: "TRADEGATE", shares: 3 }, { symbol: "NVDA", shares: 3 }])).run();
    const r = await updateDepot(env, { now: NOW, price: price({ "IE00BFMXXD54": [["2026-11-13", 100]], "IE00BMFKG444": [["2026-11-13", 50]], "US67066G1040": [["2026-11-13", 150]] }), fx: fx([["2026-11-13", 0.9]]) });
    expect(r).toMatchObject({ ok: true, added: 1 });
    expect((await rows()).map(x => [x.date, x.amount, x.estimated])).toEqual([["2026-11-12", 1000, false], ["2026-11-13", 720, false]]);
  });
  it("fehlendes XNAS erzeugt keinen Gesamtwert aus VUAA oder SPY", async () => {
    await hand("2026-11-12", 1000);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('investHoldings',?)").bind(JSON.stringify([{ symbol: "VUAA", exchange: "TRADEGATE", shares: 2 }, { symbol: "XNAS", exchange: "TRADEGATE", shares: 3 }])).run();
    const r = await updateDepot(env, { now: NOW, price: price({ SPY, "IE00BFMXXD54": [["2026-11-13", 100]] }), fx: fx([["2026-11-13", 1]]) });
    expect(r).toMatchObject({ ok: false, added: 0 });
    expect(await rows()).toHaveLength(1);
  });
});


describe("Sparplan im Lauf", () => {
  const ETF = [{ symbol: "VUAA", shares: 2 }, { symbol: "XNAS", shares: 3 }];
  const setup = async (day = "13") => {
    await hand("2026-10-14", 1000);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('investHoldings',?),('investDay',?)").bind(JSON.stringify(ETF), day).run();
  };
  const src = (vuaa: [string, number][], xnas: [string, number][]) => ({ now: NOW, price: price({ IE00BFMXXD54: vuaa, IE00BMFKG444: xnas }), fx: fx([["2026-11-01", 0.9]]) });
  const buys = async () => (await db.select().from(schema.depotBuys).all()).sort((a, b) => a.depositKey.localeCompare(b.depositKey) || a.symbol.localeCompare(b.symbol));

  it("Monatsrate wird 50/50 gekauft, der Wert enthält die Käufe, ein zweiter Lauf kauft nicht doppelt", async () => {
    await setup();
    const o = src([["2026-11-13", 100]], [["2026-11-13", 50]]);
    const r = await updateDepot(env, o);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("2 Käufe");
    const b = await buys();
    expect(b.map((x) => [x.depositKey, x.symbol, x.chf, x.buyDate, x.late])).toEqual([["m:2026-11", "VUAA", 175, "2026-11-13", false], ["m:2026-11", "XNAS", 175, "2026-11-13", false]]);
    expect(b[0]!.shares).toBeCloseTo(175 / 90, 5);
    expect((await rows()).find((x) => x.date === "2026-11-13")!.amount).toBeCloseTo(2 * 90 + 3 * 45 + 350, 1);
    await updateDepot(env, o);
    expect(await buys()).toHaveLength(2);
    expect((await rows()).filter((x) => x.date === "2026-11-13")).toHaveLength(1);
  });
  it("Zusatz-Einzahlung von Hand wird gekauft und zählt zum Wert", async () => {
    await setup("28");
    await env.DB.exec("INSERT INTO investment_entries (id,kind,date,amount,note) VALUES ('z1','deposit','2026-11-16',100,'von Hand')");
    await updateDepot(env, src([["2026-11-16", 100]], [["2026-11-16", 50]]));
    expect((await buys()).map((x) => [x.depositKey, x.symbol, x.chf])).toEqual([["d:z1", "VUAA", 50], ["d:z1", "XNAS", 50]]);
    expect((await rows()).find((x) => x.date === "2026-11-16" && x.kind === "value")!.amount).toBeCloseTo(2 * 90 + 3 * 45 + 100, 1);
  });
  it("fehlender Kurs: nur das Symbol mit Kurs wird gekauft, kein Teilwert; später verspätet nachgeholt", async () => {
    await setup();
    const r = await updateDepot(env, src([["2026-11-13", 100]], []));
    expect(r.ok).toBe(false);
    expect((await buys()).map((x) => x.symbol)).toEqual(["VUAA"]);
    expect(await rows()).toHaveLength(1);
    await updateDepot(env, src([["2026-11-17", 100]], [["2026-11-17", 50]]));
    expect((await buys()).map((x) => [x.symbol, x.buyDate, x.late])).toEqual([["VUAA", "2026-11-13", false], ["XNAS", "2026-11-17", true]]);
  });
  it("neuer Handwert setzt die Basis zurück: frühere Käufe zählen nicht, nichts wird gelöscht", async () => {
    await setup();
    await updateDepot(env, src([["2026-11-13", 100]], [["2026-11-13", 50]]));
    await hand("2026-11-16", 1500);
    await updateDepot(env, src([["2026-11-17", 100]], [["2026-11-17", 50]]));
    expect(await buys()).toHaveLength(2);
    expect((await rows()).find((x) => x.date === "2026-11-17")!.amount).toBeCloseTo(2 * 100 * 0.9 + 3 * 50 * 0.9, 1);
    const res = await exports.default.fetch(new Request("http://localhost/api/depot/buys"));
    expect(await res.json()).toEqual([]);
  });
  it("Einstellung investSplit wird geprüft", async () => {
    const put = (v: string) => exports.default.fetch(new Request("http://localhost/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ investSplit: v }) }));
    expect((await put('[{"symbol":"VUAA","pct":70},{"symbol":"XNAS","pct":30}]')).status).toBe(200);
    expect((await put('[{"symbol":"VUAA","pct":70}]')).status).toBe(400);
    expect((await put('[{"symbol":"ABC","pct":100}]')).status).toBe(400);
  });
});
