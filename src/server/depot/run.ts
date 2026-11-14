// Täglicher Depotlauf: Kurse holen, Depotwert fortschreiben, sync_runs (Art "depot") festhalten.
// Ohne Kurs entsteht kein Wert. Von Hand eingetragene Werte werden nie verändert oder gelöscht;
// nur vom Lauf selbst geschriebene Zeilen (geschätzt oder "auto") desselben Tages werden ersetzt.
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { addDays, todayInZone } from "../../shared/dates";
import { AUTO_NOTE, depotConfig, depotRules, planValues, toDepotEntry, type Close, type NewValue } from "../../shared/depot";
import { SETTING_DEFAULTS, type Settings } from "../../shared/settings";
import { newId, nowIso, type Bindings, type Db } from "../util";
import { ISIN, SYMBOL, cboe, frankfurter, type FxSource, type PriceSource } from "./kurse";

export const KIND = "depot";
/** Vergleichs-ETF für die Schätzung: SPDR S&P 500 (SPY), US-Börse, in USD. */
export const PROXY_SYMBOL = "SPY";
/** Kurse ab so vielen Tagen vor dem letzten Handwert (damit am Wochenende eingetragene Werte eine Basis haben). */
const WINDOW_DAYS = 10;
const MAX_ROWS = 90;
const RETRY_MIN = 55;

const { investmentEntries, syncRuns, settings } = schema;

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
    if (ISIN.test(cfg.symbol)) return await done(false, "Die Kursquelle kennt nur Kürzel (z.B. VOO), keine ISIN");
    const exactWanted = SYMBOL.test(cfg.symbol) && cfg.shares > 0;
    const since = addDays(base.date, -WINDOW_DAYS);

    const proxy = await price.closes(PROXY_SYMBOL, since, f);
    const usd = await fxSrc.rates("USD", since, f);
    if (!proxy.length || !usd.length) return await done(false, "Kursquelle nicht erreichbar, kein neuer Wert");
    let held: Close[] = [];
    let heldFx: Close[] | null = null;
    if (exactWanted) {
      held = await price.closes(cfg.symbol, since, f);
      heldFx = cfg.currency === "USD" ? usd : cfg.currency === "CHF" ? null : await fxSrc.rates("EUR", since, f);
    }
    const plan = planValues({ entries, rules: depotRules(s), config: cfg, proxy, proxyFx: usd, held, heldFx, today }).slice(-MAX_ROWS);
    const exactUsed = plan.some((p) => !p.estimated);
    const note = exactWanted && !held.length ? " (Produkt nicht gefunden, geschätzt)" : "";
    if (!plan.length) return await done(true, "Kein neuer Kurs" + note);
    await write(db, plan);
    const last = plan.at(-1)!;
    return await done(true, `${plan.length} ${plan.length === 1 ? "Wert" : "Werte"} bis ${last.date}, ${exactUsed ? "berechnet" : "geschätzt"}${note}`, plan.length);
  } catch (e) {
    console.error("Depot-Abruf fehlgeschlagen:", (e as Error)?.name ?? "unbekannt");
    return await done(false, "Unerwarteter Fehler beim Depot-Abruf");
  }
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

