import { beforeEach, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/server/db/schema";
import { depotDue, updateDepot } from "../src/server/depot/run";
import { cboe, frankfurter, type FxSource, type PriceSource } from "../src/server/depot/kurse";

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
  for (const t of ["investment_entries", "sync_runs", "settings"]) await env.DB.exec(`DELETE FROM ${t}`);
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
