// Kursquellen für das Depot. Austauschbar: wer eine andere Quelle will, liefert dieselbe Form (Schlusskurse je Handelstag).
// Alle Abrufe sind fehlertolerant: bei jedem Problem kommt eine leere Liste, nie ein geratener Kurs.
// Beleg und Nutzungsbedingungen: docs/depot.md.
import type { Close } from "../../shared/depot";

export type Fetcher = typeof fetch;
export interface PriceSource {
  name: string;
  /** Schlusskurse (Handelstage) eines Kürzels, älteste zuerst; leer bei Fehler oder unbekanntem Kürzel. */
  closes(symbol: string, since: string, f: Fetcher): Promise<Close[]>;
}
export interface FxSource {
  name: string;
  /** Franken pro Einheit der Währung, je Tag, älteste zuerst; leer bei Fehler. */
  rates(currency: "USD" | "EUR", since: string, f: Fetcher): Promise<Close[]>;
}

const TIMEOUT_MS = 8000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Nur Kürzel dürfen in die Adresse. */
export const SYMBOL = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

async function getJson(url: string, f: Fetcher): Promise<unknown> {
  const res = await f(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Cboe, verzögerte Tageskurse der öffentlichen Webseite (ohne Schlüssel, US-Börsen: SPY, VOO, IVV, ...).
 * https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/<KÜRZEL>.json
 * Antwort: { symbol, timestamp, data: [{ date, open, high, low, close, volume }, ...] }, ganze Geschichte, älteste zuerst.
 */
export const cboe: PriceSource = {
  name: "cboe",
  async closes(symbol, since, f) {
    if (!SYMBOL.test(symbol)) return [];
    try {
      const j = (await getJson(`https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/${symbol}.json`, f)) as { data?: { date?: unknown; close?: unknown }[] };
      if (!Array.isArray(j?.data)) return [];
      const out: Close[] = [];
      for (const r of j.data) {
        if (typeof r?.date === "string" && DATE.test(r.date) && r.date >= since && typeof r.close === "number" && Number.isFinite(r.close) && r.close > 0) out.push({ date: r.date, close: r.close });
      }
      return out.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },
};

/**
 * Frankfurter (Referenzkurse der EZB und weiterer Zentralbanken, ohne Schlüssel).
 * https://api.frankfurter.dev/v2/rates?base=USD&quotes=CHF&from=YYYY-MM-DD
 * Antwort: [{ date, base, quote, rate }, ...]
 */
export const frankfurter: FxSource = {
  name: "frankfurter",
  async rates(currency, since, f) {
    try {
      const j = (await getJson(`https://api.frankfurter.dev/v2/rates?base=${currency}&quotes=CHF&from=${since}`, f)) as { date?: unknown; rate?: unknown }[];
      if (!Array.isArray(j)) return [];
      const out: Close[] = [];
      for (const r of j) if (typeof r?.date === "string" && DATE.test(r.date) && typeof r.rate === "number" && r.rate > 0) out.push({ date: r.date, close: r.rate });
      return out.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  },
};
