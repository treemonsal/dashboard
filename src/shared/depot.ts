// Depotrechnung (rein, ohne I/O). Beträge in Franken.
//
// Regeln:
// - Der allererste von Hand eingetragene Wert ist der Startbestand: zählt vollständig als einbezahlt, Gewinn 0.
// - Einbezahlt = Startbestand + monatliche Einzahlung ab dem Monat NACH dem Startbestand (am Stichtag, Standard der 25.)
//   + von Hand nachgetragene Einzahlungen, die nach dem Startbestand liegen.
// - Gewinn zu einem Wert = Wert minus das, was bis zu dessen Datum einbezahlt war.
// - Geschätzte Werte (estimated) schreibt der tägliche Lauf fort; sie sind nie Startbestand und nie Basis, ein Handwert gewinnt.

export interface DepotEntry {
  id?: string;
  kind: "value" | "deposit";
  date: string;
  amount: number;
  estimated?: boolean;
  /** Vom Lauf aus Anteilen und Kurs berechnet (genau, aber nicht von Hand): nie Startbestand, nie Basis. */
  auto?: boolean;
  createdAt?: string;
}
const isHand = (e: DepotEntry) => !e.estimated && !e.auto;
export interface DepotRules {
  /** Einzahlung pro Monat */
  monthly: number;
  /** Stichtag im Monat, 1 bis 28 (Standard 25) */
  day: number;
}
export interface DepotPoint {
  date: string;
  value: number;
  estimated: boolean;
  deposited: number;
  gain: number;
}
export interface DepotState {
  /** Startbestand (erster Handwert) */
  start: { date: string; amount: number } | null;
  /** Letzter Wert (von Hand oder geschätzt/berechnet) */
  latest: DepotPoint | null;
  deposited: number;
  gain: number | null;
  /** Gewinn in Prozent der Einzahlungen, null ohne Wert */
  pct: number | null;
  /** Verlauf je Wert, älteste zuerst */
  series: DepotPoint[];
}
export interface Close {
  date: string;
  close: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function monthDate(y: number, m: number, day: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Anzahl Stichtage der monatlichen Einzahlung in den Monaten nach dem Startmonat bis und mit `date`. */
export function monthlyCount(startDate: string, date: string, day: number): number {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(date)) return 0;
  // Erste Rate: Stichtag im Startmonat, falls er nach dem Startwert liegt, sonst im Folgemonat.
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  if (monthDate(y, m, day) <= startDate) { m++; if (m > 12) { m = 1; y++; } }
  let n = 0;
  while (monthDate(y, m, day) <= date) {
    n++;
    m++;
    if (m > 12) { m = 1; y++; }
    if (n > 1200) break;
  }
  return n;
}

const byDate = <T extends { date: string; createdAt?: string }>(a: T, b: T) => (a.date === b.date ? (a.createdAt ?? "").localeCompare(b.createdAt ?? "") : a.date.localeCompare(b.date));

/** Erster Handwert. */
export function startOf(entries: DepotEntry[]): { date: string; amount: number } | null {
  const first = entries.filter((e) => e.kind === "value" && isHand(e)).sort(byDate)[0];
  return first ? { date: first.date, amount: first.amount } : null;
}

/** Einbezahlt bis und mit `date` (nie weniger als der Startbestand). */
export function depositedAt(entries: DepotEntry[], rules: DepotRules, date: string): number {
  const s = startOf(entries);
  if (!s) return 0;
  const manual = entries.filter((e) => e.kind === "deposit" && e.date > s.date && e.date <= date).reduce((a, e) => a + e.amount, 0);
  return r2(s.amount + manual + monthlyCount(s.date, date, rules.day) * rules.monthly);
}

export function depotState(entries: DepotEntry[], rules: DepotRules): DepotState {
  const s = startOf(entries);
  const vals = entries.filter((e) => e.kind === "value").sort(byDate);
  // Je Datum ein Wert: ein Handwert verdrängt einen berechneten oder geschätzten vom selben Tag.
  const perDay = new Map<string, DepotEntry>();
  for (const e of vals) {
    const old = perDay.get(e.date);
    if (!old || !isHand(old) || isHand(e)) perDay.set(e.date, e);
  }
  const series: DepotPoint[] = [...perDay.values()]
    .filter((e) => s && e.date >= s.date)
    .map((e) => {
      const deposited = depositedAt(entries, rules, e.date);
      // Am Startbestand ist der Gewinn per Definition 0.
      const gain = s && e.date === s.date && isHand(e) ? 0 : r2(e.amount - deposited);
      return { date: e.date, value: e.amount, estimated: !!e.estimated, deposited, gain };
    });
  const latest = series.at(-1) ?? null;
  return {
    start: s,
    latest,
    deposited: latest?.deposited ?? 0,
    gain: latest ? latest.gain : null,
    pct: latest && latest.deposited > 0 ? r2((latest.gain / latest.deposited) * 100) : latest ? 0 : null,
    series,
  };
}

/** Letzter Wert mit Datum bis und mit `date`. */
export function onOrBefore(series: Close[], date: string): Close | null {
  let best: Close | null = null;
  for (const c of series) if (c.date <= date && (!best || c.date > best.date)) best = c;
  return best;
}

export interface DepotConfig {
  /** Kürzel des gehaltenen Produkts (leer = Schätzung) */
  symbol: string;
  /** Anzahl Anteile (0 = Schätzung) */
  shares: number;
  currency: "USD" | "CHF" | "EUR";
}
export interface NewValue {
  date: string;
  amount: number;
  estimated: boolean;
}

/**
 * Neue Depotwerte aus Kursen.
 * - `proxy`: Schlusskurse des Vergleichs-ETF (Schätzung), `held`: Schlusskurse des gehaltenen Produkts (genau).
 * - `fx(currency)`: Franken pro Einheit Fremdwährung, je Tag. Für CHF nicht nötig.
 * Ohne Kurs entsteht kein Wert. Liefert nur Tage nach dem letzten Handwert und bis `today`.
 */
export function planValues(o: {
  entries: DepotEntry[];
  rules: DepotRules;
  config: DepotConfig;
  proxy: Close[];
  proxyFx: Close[] | null;
  held: Close[];
  heldFx: Close[] | null;
  today: string;
}): NewValue[] {
  const hand = o.entries.filter((e) => e.kind === "value" && isHand(e)).sort(byDate);
  const base = hand.at(-1);
  if (!base) return [];
  const out: NewValue[] = [];
  const exact = !!o.config.symbol && o.config.shares > 0 && o.held.length > 0;
  if (exact) {
    const chf = o.config.currency === "CHF";
    for (const c of o.held) {
      if (c.date <= base.date || c.date > o.today || !(c.close > 0)) continue;
      const fx = chf ? 1 : onOrBefore(o.heldFx ?? [], c.date)?.close;
      if (!fx) continue;
      out.push({ date: c.date, amount: r2(o.config.shares * c.close * fx), estimated: false });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  // Schätzung: Handwert mal Kursänderung (in Franken) seit dem Handwert plus Einzahlungen seither.
  const p0 = onOrBefore(o.proxy, base.date);
  const f0 = onOrBefore(o.proxyFx ?? [], base.date);
  if (!p0 || !f0 || !(p0.close > 0)) return [];
  const before = depositedAt(o.entries, o.rules, base.date);
  for (const c of o.proxy) {
    if (c.date <= base.date || c.date > o.today || !(c.close > 0)) continue;
    const f = onOrBefore(o.proxyFx ?? [], c.date);
    if (!f) continue;
    const factor = (c.close * f.close) / (p0.close * f0.close);
    const added = depositedAt(o.entries, o.rules, c.date) - before;
    out.push({ date: c.date, amount: r2(base.amount * factor + added), estimated: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Notiz-Marke der vom Lauf genau berechneten Werte. */
export const AUTO_NOTE = "auto";
export function toDepotEntry(r: { id?: string; kind: "value" | "deposit"; date: string; amount: number; note?: string | null; estimated?: boolean; createdAt?: string }): DepotEntry {
  return { id: r.id, kind: r.kind, date: r.date, amount: r.amount, estimated: !!r.estimated, auto: r.note === AUTO_NOTE, createdAt: r.createdAt };
}
export function depotRules(s: { investMonthly: string; investDay: string }): DepotRules {
  return { monthly: Number(s.investMonthly) || 0, day: Math.min(28, Math.max(1, Number(s.investDay) || 25)) };
}
export function depotConfig(s: { investSymbol: string; investShares: string; investCurrency: string }): DepotConfig {
  const cur = s.investCurrency === "CHF" || s.investCurrency === "EUR" ? s.investCurrency : "USD";
  return { symbol: s.investSymbol.trim().toUpperCase(), shares: Number(s.investShares) || 0, currency: cur };
}

export interface PortfolioProduct {
  symbol: string;
  name: string;
  isin: string;
  index: string;
  currency: "EUR";
}
/** Bewertungsnotierung: Tradegate EUR, unabhängig vom ursprünglichen Kaufplatz. */
export const PORTFOLIO_PRODUCTS: PortfolioProduct[] = [
  { symbol: "VUAA", name: "Vanguard S&P 500", isin: "IE00BFMXXD54", index: "S&P 500", currency: "EUR" },
  { symbol: "XNAS", name: "Xtrackers Nasdaq 100", isin: "IE00BMFKG444", index: "Nasdaq 100", currency: "EUR" },
  { symbol: "NVDA", name: "NVIDIA", isin: "US67066G1040", index: "Einzelaktie", currency: "EUR" },
];
export const CONFIRMED_HOLDINGS = [{ symbol: "VUAA", shares: 12.2 }, { symbol: "XNAS", shares: 23 }, { symbol: "NVDA", shares: 3 }];
export const portfolioProduct = (symbol: string): PortfolioProduct | null => PORTFOLIO_PRODUCTS.find(p => p.symbol === symbol) ?? null;
export interface PortfolioHolding extends DepotConfig { exchange: "TRADEGATE" | "US" }
export function depotHoldings(s: { investSymbol: string; investShares: string; investCurrency: string; investHoldings?: string }): PortfolioHolding[] | null {
  if (!s.investHoldings?.trim()) {
    if (s.investSymbol.trim()) return [{ ...depotConfig(s), exchange: "US" }];
    return CONFIRMED_HOLDINGS.map(h => ({ ...h, currency: "EUR", exchange: "TRADEGATE" }));
  }
  try {
    const rows: unknown = JSON.parse(s.investHoldings);
    if (!Array.isArray(rows) || rows.length > 20) return null;
    const result: PortfolioHolding[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || !portfolioProduct(row.symbol) || typeof row.shares !== "number" || !Number.isFinite(row.shares) || row.shares <= 0 || seen.has(row.symbol)) return null;
      seen.add(row.symbol);
      result.push({ symbol: row.symbol, shares: row.shares, currency: "EUR", exchange: "TRADEGATE" });
    }
    return result;
  } catch { return null; }
}

/** Nur vollständige, gleich datierte Kurse ergeben einen Gesamtwert. Keine Teilwerte, kein Proxy. */
export function planPortfolioValues(o: { entries: DepotEntry[]; today: string; positions: { config: DepotConfig; held: Close[]; fx: Close[] | null; /** Aus Einzahlungen gekaufte Anteile (Kaufdatum), zählen ab diesem Tag zusätzlich */ lots?: Lot[] }[] }): NewValue[] {
  const base = o.entries.filter(e => e.kind === "value" && isHand(e)).sort(byDate).at(-1);
  if (!base || !o.positions.length || o.positions.some(p => !p.held.length || !(p.config.shares + lotShares(p.lots, o.today) > 0))) return [];
  const dates = [...new Set(o.positions[0]!.held.map(c => c.date))].filter(d => d > base.date && d <= o.today).sort();
  const out: NewValue[] = [];
  for (const date of dates) {
    let amount = 0;
    let complete = true;
    for (const p of o.positions) {
      const close = p.held.find(c => c.date === date)?.close;
      const fx = p.config.currency === "CHF" ? 1 : onOrBefore(p.fx ?? [], date)?.close;
      if (!close || !Number.isFinite(close) || close <= 0 || !fx || !Number.isFinite(fx) || fx <= 0) { complete = false; break; }
      amount += (p.config.shares + lotShares(p.lots, date)) * close * fx;
    }
    if (complete && Number.isFinite(amount)) out.push({ date, amount: r2(amount), estimated: false });
  }
  return out;
}

/* ---------- Sparplan: Käufe aus Einzahlungen ---------- */
export interface SplitPart { symbol: string; pct: number }
export const DEFAULT_SPLIT: SplitPart[] = [{ symbol: "VUAA", pct: 50 }, { symbol: "XNAS", pct: 50 }];
export const DEFAULT_SPLIT_JSON = JSON.stringify(DEFAULT_SPLIT);

/** Aufteilung prüfen: nur bekannte Symbole, je einmal, Anteile 0 bis 100 (ohne 0), Summe 100. Sonst null. */
export function parseSplit(raw: string): SplitPart[] | null {
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length || rows.length > PORTFOLIO_PRODUCTS.length) return null;
    const seen = new Set<string>();
    let sum = 0;
    const out: SplitPart[] = [];
    for (const r of rows as { symbol?: unknown; pct?: unknown }[]) {
      if (!r || typeof r.symbol !== "string" || !portfolioProduct(r.symbol) || seen.has(r.symbol) || typeof r.pct !== "number" || !Number.isFinite(r.pct) || r.pct <= 0 || r.pct > 100) return null;
      seen.add(r.symbol);
      sum += r.pct;
      out.push({ symbol: r.symbol, pct: r.pct });
    }
    return Math.abs(sum - 100) < 1e-9 ? out : null;
  } catch { return null; }
}
/** Gespeicherte Aufteilung; leer oder ungültig ergibt den Standard 50/50 VUAA und XNAS. */
export const depotSplit = (s: { investSplit?: string }): SplitPart[] => (s.investSplit?.trim() ? parseSplit(s.investSplit) : null) ?? DEFAULT_SPLIT;

export interface Lot { date: string; shares: number }
export const lotShares = (lots: Lot[] | undefined, date: string): number => (lots ?? []).reduce((a, l) => (l.date <= date ? a + l.shares : a), 0);

export interface DepotDeposit {
  /** "m:YYYY-MM" Monatsrate, "d:<id>" von Hand */
  key: string;
  date: string;
  amount: number;
  manual: boolean;
}
/** Letzter Handwert: ab hier gelten die Anteile aus den Einstellungen, frühere Käufe zählen nicht. */
export function baseOf(entries: DepotEntry[]): { date: string; amount: number } | null {
  const b = entries.filter((e) => e.kind === "value" && isHand(e)).sort(byDate).at(-1);
  return b ? { date: b.date, amount: b.amount } : null;
}
/** Einzahlungen nach dem letzten Handwert und bis und mit `upTo`: Monatsrate am Stichtag und Zusatz-Einzahlungen von Hand. */
export function depositsAfter(entries: DepotEntry[], rules: DepotRules, upTo: string): DepotDeposit[] {
  const s = startOf(entries);
  const base = baseOf(entries);
  if (!s || !base) return [];
  const out: DepotDeposit[] = [];
  if (rules.monthly > 0) {
    let y = Number(s.date.slice(0, 4));
    let m = Number(s.date.slice(5, 7));
    if (monthDate(y, m, rules.day) <= s.date) { m++; if (m > 12) { m = 1; y++; } }
    for (let i = 0; i < 1200; i++) {
      const date = monthDate(y, m, rules.day);
      if (date > upTo) break;
      if (date > base.date) out.push({ key: `m:${y}-${String(m).padStart(2, "0")}`, date, amount: rules.monthly, manual: false });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  for (const e of entries) if (e.kind === "deposit" && e.id && e.amount > 0 && e.date > base.date && e.date <= upTo) out.push({ key: `d:${e.id}`, date: e.date, amount: e.amount, manual: true });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export interface Buy {
  depositKey: string;
  depositDate: string;
  symbol: string;
  chf: number;
  shares: number;
  price: number;
  fx: number;
  buyDate: string;
  late: boolean;
}
/** Nächster Werktag am oder nach `date` (Feiertage unbekannt). */
export function nextWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Neue Käufe: je Einzahlung und Symbol zum ersten Kurs am oder nach dem Einzahlungsdatum (bis `today`).
 * Betrag mal Anteil geteilt durch Kurs in EUR mal EUR/CHF. Ohne Kurs oder Wechselkurs entsteht kein Kauf (kein erfundener Kurs).
 * `have`: schon gekaufte "Schlüssel|Symbol". `late`: der erste verfügbare Kurs lag nach dem ersten Werktag.
 */
export function planBuys(o: { deposits: DepotDeposit[]; split: SplitPart[]; have: Set<string>; closes: Record<string, Close[]>; fx: Close[] | null; today: string }): Buy[] {
  const out: Buy[] = [];
  for (const dep of o.deposits) {
    for (const part of o.split) {
      if (o.have.has(`${dep.key}|${part.symbol}`)) continue;
      const first = (o.closes[part.symbol] ?? []).filter((c) => c.date >= dep.date && c.date <= o.today && c.close > 0).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (!first) continue;
      const fx = onOrBefore(o.fx ?? [], first.date)?.close;
      if (!fx || !(fx > 0)) continue;
      const chf = r2((dep.amount * part.pct) / 100);
      out.push({ depositKey: dep.key, depositDate: dep.date, symbol: part.symbol, chf, shares: r6(chf / (first.close * fx)), price: first.close, fx, buyDate: first.date, late: first.date > nextWeekday(dep.date) });
    }
  }
  return out;
}

/** Nur Käufe, deren Einzahlung noch zählt (nach dem letzten Handwert, nicht gelöscht). */
export function validBuys<T extends { depositKey: string }>(buys: T[], deposits: DepotDeposit[]): T[] {
  const keys = new Set(deposits.map((d) => d.key));
  return buys.filter((b) => keys.has(b.depositKey));
}
export function lotsBySymbol(buys: { symbol: string; buyDate: string; shares: number }[]): Record<string, Lot[]> {
  const out: Record<string, Lot[]> = {};
  for (const b of buys) (out[b.symbol] ??= []).push({ date: b.buyDate, shares: b.shares });
  return out;
}
