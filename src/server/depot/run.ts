// Täglicher Depotlauf: Kurse holen, Depotwert fortschreiben, sync_runs (Art "depot") festhalten.
// Ohne Kurs entsteht kein Wert. Von Hand eingetragene Werte werden nie verändert oder gelöscht;
// nur vom Lauf selbst geschriebene Zeilen (geschätzt oder "auto") desselben Tages werden ersetzt.
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { addDays, todayInZone } from "../../shared/dates";
import { AUTO_NOTE, depositsAfter, depotHoldings, depotSplit, lotsBySymbol, planBuys, portfolioProduct, planPortfolioValues, depotConfig, depotRules, planValues, toDepotEntry, validBuys, type Buy, type Close, type NewValue } from "../../shared/depot";
import { SETTING_DEFAULTS, type Settings } from "../../shared/settings";
import { newId, nowIso, type Bindings, type Db } from "../util";
import { ISIN, cboe, tradegate, frankfurter, type FxSource, type PriceSource } from "./kurse";

export const KIND = "depot";
/** Vergleichs-ETF für die Schätzung: SPDR S&P 500 (SPY), US-Börse, in USD. */
export const PROXY_SYMBOL = "SPY";
/** Kurse ab so vielen Tagen vor dem letzten Handwert (damit am Wochenende eingetragene Werte eine Basis haben). */
const WINDOW_DAYS = 10;
const MAX_ROWS = 90;
const RETRY_MIN = 55;

const { investmentEntries, syncRuns, settings, depotBuys } = schema;

export interface DepotDeps {
  fetcher?: typeof fetch;
  now?: Date;
  price?: PriceSource;
  fx?: FxSource;
}
export interface DepotResult {
  ok: boolean;
  message: string;
  added: number;
}

async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as Settings;
}

async function record(db: Db, ok: boolean, message: string): Promise<void> {
  await db.insert(syncRuns).values({ id: newId(), kind: KIND, ok, message: message.slice(0, 500) });
}

export async function updateDepot(env: Bindings, deps: DepotDeps = {}): Promise<DepotResult> {
  const db: Db = drizzle(env.DB, { schema });
  const f = deps.fetcher ?? fetch;
  const price = deps.price ?? cboe;
  const fxSrc = deps.fx ?? frankfurter;
  const today = todayInZone(deps.now ?? new Date());
  const done = async (ok: boolean, message: string, added = 0): Promise<DepotResult> => {
    await record(db, ok, message);
    return { ok, message, added };
  };
  try {
    const s = await loadSettings(db);
    const rows = await db.select().from(investmentEntries);
    const entries = rows.map((r) => toDepotEntry({ ...r, createdAt: r.createdAt }));
    const base = entries.filter((e) => e.kind === "value" && !e.estimated && !e.auto).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (!base) return await done(true, "Noch kein Startwert eingetragen");
    const cfg = depotConfig(s);
    const holdings = depotHoldings(s);
    if (!holdings) return await done(false, "Portfolio Positionen unvollständig oder ungültig");
    const since = addDays(base.date, -WINDOW_DAYS);
    let plan: NewValue[];
    let buyNote = "";
    let bought = 0;
    if (holdings.length) {
      if (holdings.some(h => !(h.shares > 0) || ISIN.test(h.symbol))) return await done(false, "Kürzel und positive Anteile prüfen");
      const rules = depotRules(s);
      const split = depotSplit(s);
      // Käufe aus Einzahlungen nur im reinen Tradegate Portfolio (sonst gäbe es keine Kursbasis).
      const sparen = holdings.every(h => h.exchange === "TRADEGATE");
      const symbols = [...new Set([...holdings.map(h => h.symbol), ...(sparen ? split.map(p => p.symbol) : [])])];
      const fxCache = new Map<string, Promise<Close[]>>();
      const fxOf = (cur: "USD" | "EUR") => (fxCache.get(cur) ?? fxCache.set(cur, fxSrc.rates(cur, since, f)).get(cur)!);
      const eur = sparen ? await fxOf("EUR") : null;
      const fetched: Record<string, Close[]> = {};
      await Promise.all(symbols.map(async symbol => {
        const holding = holdings.find(h => h.symbol === symbol);
        const exchange = holding?.exchange ?? "TRADEGATE";
        const product = portfolioProduct(symbol);
        fetched[symbol] = deps.price
          ? await deps.price.closes(exchange === "TRADEGATE" ? product!.isin : symbol, since, f)
          : exchange === "TRADEGATE"
            ? await tradegate.closes(product!.isin, since, f, deps.now ?? new Date())
            : await price.closes(symbol, since, f);
      }));
      let lots: ReturnType<typeof lotsBySymbol> = {};
      if (sparen) {
        const deposits = depositsAfter(entries, rules, today);
        const existing = await db.select().from(depotBuys);
        const have = new Set(existing.map(b => `${b.depositKey}|${b.symbol}`));
        const fresh = planBuys({ deposits, split, have, closes: fetched, fx: eur, today });
        await writeBuys(db, fresh);
        bought = fresh.length;
        lots = lotsBySymbol(validBuys([...existing, ...fresh], deposits));
      }
      const all = await Promise.all(symbols.map(async symbol => {
        const config = holdings.find(h => h.symbol === symbol) ?? { symbol, shares: 0, currency: "EUR" as const, exchange: "TRADEGATE" as const };
        return { config, held: fetched[symbol] ?? [], fx: config.currency === "CHF" ? null : await fxOf(config.currency), lots: lots[symbol] };
      }));
      const positions = all.filter(p => p.config.shares > 0 || (p.lots?.length ?? 0) > 0);
      const kaeufe = bought ? ` · ${bought} ${bought === 1 ? "Kauf" : "Käufe"} aus Einzahlungen` : "";
      const missing = positions.filter(p => !p.held.length || (p.config.currency !== "CHF" && !p.fx?.length));
      if (missing.length) return await done(false, `Kein vollständiger Kurs für ${missing.map(p => p.config.symbol).join(", ")}; kein neuer Gesamtwert${kaeufe}`, 0);
      plan = planPortfolioValues({ entries, today, positions }).slice(-MAX_ROWS);
      buyNote = kaeufe;
    } else {
      const proxy = await price.closes(PROXY_SYMBOL, since, f);
      const usd = await fxSrc.rates("USD", since, f);
      if (!proxy.length || !usd.length) return await done(false, "Kursquelle nicht erreichbar, kein neuer Wert");
      plan = planValues({ entries, rules: depotRules(s), config: cfg, proxy, proxyFx: usd, held: [], heldFx: null, today }).slice(-MAX_ROWS);
    }
    const exactUsed = plan.some((p) => !p.estimated);
    const note = holdings.some(h => h.exchange === "TRADEGATE") ? " · Bewertung Tradegate EUR in CHF" : "";
    if (!plan.length) return await done(true, "Kein neuer Kurs" + note + buyNote);
    await write(db, plan);
    const last = plan.at(-1)!;
    return await done(true, `${plan.length} ${plan.length === 1 ? "Wert" : "Werte"} bis ${last.date}, ${exactUsed ? "berechnet" : "geschätzt"}${note}${buyNote}`, plan.length);
  } catch (e) {
    console.error("Depot-Abruf fehlgeschlagen:", (e as Error)?.name ?? "unbekannt");
    return await done(false, "Unerwarteter Fehler beim Depot-Abruf");
  }
}

/** Käufe festhalten; je Einzahlung und Symbol nie doppelt (eindeutiger Schlüssel, ein Doppel wird ignoriert). */
async function writeBuys(db: Db, buys: Buy[]): Promise<void> {
  if (!buys.length) return;
  await db.batch(buys.map(b => db.insert(depotBuys).values({ id: newId(), ...b, updatedAt: nowIso() }).onConflictDoNothing()) as never);
}

/** Ersetzt nur Zeilen des Laufs; Handwerte desselben Tages bleiben und gehen vor. */
async function write(db: Db, plan: NewValue[]): Promise<void> {
  const dates = plan.map((p) => p.date);
  const existing = await db.select().from(investmentEntries).where(and(eq(investmentEntries.kind, "value"), inArray(investmentEntries.date, dates)));
  const hand = new Set(existing.filter((e) => !e.estimated && e.note !== AUTO_NOTE).map((e) => e.date));
  const stmts: unknown[] = [];
  const fresh = plan.filter((p) => !hand.has(p.date));
  if (!fresh.length) return;
  stmts.push(
    db.delete(investmentEntries).where(and(eq(investmentEntries.kind, "value"), inArray(investmentEntries.date, fresh.map((p) => p.date)), or(eq(investmentEntries.estimated, true), eq(investmentEntries.note, AUTO_NOTE)))),
  );
  for (const p of fresh) {
    stmts.push(db.insert(investmentEntries).values({ id: newId(), kind: "value", date: p.date, amount: p.amount, estimated: p.estimated, note: p.estimated ? "Schätzung" : AUTO_NOTE, updatedAt: nowIso() }));
  }
  await db.batch(stmts as never);
}

/** Cron: einmal pro Zürcher Tag ab 23:00 (nach US-Börsenschluss 22:00), nach einem Fehler nach 55 Minuten erneut. */
export async function depotDue(env: Bindings, now: Date = new Date()): Promise<boolean> {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 23) return false;
  const db: Db = drizzle(env.DB, { schema });
  const last = await db.select().from(syncRuns).where(eq(syncRuns.kind, KIND)).orderBy(desc(syncRuns.at)).limit(1).get();
  if (!last) return true;
  if (todayInZone(new Date(last.at)) !== todayInZone(now)) return true;
  return !last.ok && now.getTime() - Date.parse(last.at) >= RETRY_MIN * 60_000;
}

export async function runDepotIfDue(env: Bindings, now: Date = new Date()): Promise<void> {
  if (await depotDue(env, now)) await updateDepot(env, { now });
}

