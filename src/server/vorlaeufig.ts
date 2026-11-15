// Vorläufige Buchungen anlegen (Kurzbefehl, von Hand). Kategorie und Mahlzeit über die vorhandenen Regeln.
import * as schema from "./db/schema";
import { CAT, categorize, isMeal, type Buchung } from "../shared/bank";
import { loadRules } from "./bankimport";
import { newId, type Db } from "./util";

const t = schema;

export interface NeueVorlaeufige {
  accountId: string;
  /** Händler wie vom Kurzbefehl oder von Hand */
  description: string;
  /** Rappen, negativ = Ausgabe */
  rappen: number;
  currency: string;
  date: string;
  origin: "kurzbefehl" | "hand";
  /** Von Hand gewählte Kategorie; sonst entscheiden die Regeln */
  categoryId?: string | null;
  dedupe?: string | null;
  /** Nur für den Doppel-Schutz und Tests: Zeitpunkt des Eingangs */
  createdAt?: string;
}

/** Kategorie und Mahlzeit, wie sie die Buchung bekäme. Legt nichts an. */
export async function classify(db: Db, input: Pick<NeueVorlaeufige, "description" | "rappen" | "currency" | "date" | "categoryId">) {
  const cats = await db.select().from(t.categories);
  let categoryName: string | undefined;
  let categoryId: string | null = null;
  if (input.categoryId) {
    const c = cats.find((x) => x.id === input.categoryId);
    if (c) {
      categoryName = c.name;
      categoryId = c.id;
    }
  } else {
    categoryName = categorize({ description: input.description }, await loadRules(db)).category;
    const c = cats.find((x) => x.name === categoryName) ?? cats.find((x) => x.name === CAT.other);
    categoryId = c?.id ?? null;
    if (c) categoryName = c.name;
  }
  // "Essen auswärts" ist die Kategorie für Mahlzeiten von Hand: sie gilt immer als Mahlzeit, auch nach einer Neuberechnung.
  const mealOverride = categoryName === "Essen auswärts" ? true : null;
  const row: Buchung = { date: input.date, description: input.description, amount: input.rappen, currency: input.currency, amountChf: input.rappen, raw: {}, hash: "", category: categoryName, ...(mealOverride !== null ? { isMeal: mealOverride } : {}) };
  return { categoryId, categoryName: categoryName ?? null, mealOverride, mealOut: isMeal(row) };
}

export async function createProvisional(db: Db, input: NeueVorlaeufige) {
  const c = await classify(db, input);
  const row = await db
    .insert(t.transactions)
    .values({
      id: newId(),
      accountId: input.accountId,
      categoryId: c.categoryId,
      date: input.date,
      amount: input.rappen / 100,
      description: input.description,
      currency: input.currency,
      mealOut: c.mealOut,
      mealOverride: c.mealOverride,
      state: "provisional",
      origin: input.origin,
      dedupe: input.dedupe ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
    })
    .returning()
    .get();
  return row;
}

/**
 * Konto für eine Karte. Mehrere Karten (Revolut, Yuh, ZKB) laufen über den Kartennamen aus Wallet: er muss den Namen
 * (oder die Bank) eines Kontos enthalten, ohne Gross/Klein und Akzente. Passt keines, gilt das gewählte Standardkonto.
 */
export async function accountByName(db: Db, name: string, card?: string) {
  const accs = await db.select().from(t.accounts);
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = (s: string) => ` ${norm(s)} `;
  const exact = (n: string) => accs.find((a) => norm(a.name) === n || (a.bank && norm(a.bank) === n));
  if (card && norm(card)) {
    const c = words(card);
    const hits = accs.filter((a) => [a.name, a.bank ?? ""].some((x) => norm(x).length >= 2 && c.includes(` ${norm(x)} `)));
    if (hits.length === 1) return hits[0]!;
    const ex = exact(norm(card));
    if (ex) return ex;
  }
  return exact(norm(name)) ?? null;
}
