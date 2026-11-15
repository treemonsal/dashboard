// Zusätzliche Leseroute für die Tiefe: letzte Kurse der Portfolio-Positionen (nur lesend, fehlertolerant).
// Nutzt die Kursquellen aus ./depot/kurse unverändert; ohne Kurs kommt null, nie ein geratener Wert.
import type { Hono } from "hono";
import { PORTFOLIO_PRODUCTS } from "../shared/depot";
import { addDays, todayInZone } from "../shared/dates";
import { frankfurter, tradegate } from "./depot/kurse";
import type { AppEnv } from "./util";

export interface PositionQuote { symbol: string; close: number | null; date: string | null; fx: number | null }

export function registerTiefe(api: Hono<AppEnv>) {
  api.get("/depot/kurse", async (c) => {
    const since = addDays(todayInZone(), -7);
    const fx = (await frankfurter.rates("EUR", since, fetch)).at(-1)?.close ?? null;
    const out: PositionQuote[] = await Promise.all(
      PORTFOLIO_PRODUCTS.map(async (p) => {
        const last = (await tradegate.closes(p.isin, since, fetch)).at(-1);
        return { symbol: p.symbol, close: last?.close ?? null, date: last?.date ?? null, fx };
      }),
    );
    return c.json(out);
  });
}
