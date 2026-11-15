// Routen für Buchungen im laufenden Monat (hinter der Anmeldung): von Hand, Kontostand, Schlüssel für den Kurzbefehl.
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { balanceEntry, provisionalCreate } from "../shared/schemas";
import { saldoAbgleich, type SaldoAnker, type SaldoEingabe } from "../shared/saldo";
import { cleanMerchant } from "../shared/bank";
import { todayInZone } from "../shared/dates";
import { createIntakeKey, intakeStatus, intakeTest, revokeIntakeKey } from "./eingang";
import { createProvisional } from "./vorlaeufig";
import { idParam, notFound, nowIso, v, type AppEnv, type Db } from "./util";

const t = schema;

export const anchorOf = (a: typeof t.accounts.$inferSelect): SaldoAnker | null =>
  a.anchorBalance !== null && a.anchorDay ? { balance: a.anchorBalance, day: a.anchorDay, kind: a.anchorKind === "eingabe" ? "eingabe" : "auszug", at: a.anchorAt } : null;
export const enteredOf = (a: typeof t.accounts.$inferSelect): SaldoEingabe | null =>
  a.enteredBalance !== null && a.enteredDay && a.enteredAt ? { balance: a.enteredBalance, day: a.enteredDay, at: a.enteredAt } : null;

/** Abgleich eines Kontos aus der Datenbank. */
export async function accountSaldo(db: Db, accountId: string) {
  const acc = await db.select().from(t.accounts).where(eq(t.accounts.id, accountId)).get();
  if (!acc) return null;
  const rows = await db.select({ date: t.transactions.date, amount: t.transactions.amount, createdAt: t.transactions.createdAt, state: t.transactions.state }).from(t.transactions).where(eq(t.transactions.accountId, accountId));
  return { acc, result: saldoAbgleich(anchorOf(acc), enteredOf(acc), rows.map((r) => ({ date: r.date, amount: r.amount, createdAt: r.createdAt, provisional: r.state === "provisional" }))) };
}

export function registerLaufend(api: Hono<AppEnv>) {
  /** Vorläufige Buchung von Hand (nur Ausgaben). */
  api.post("/provisional", v("json", provisionalCreate), async (c) => {
    const b = c.req.valid("json");
    const merchant = cleanMerchant(b.merchant);
    if (!merchant) return c.json({ error: "Ungültige Eingabe" }, 400);
    const acc = await c.var.db.select({ id: t.accounts.id, currency: t.accounts.currency }).from(t.accounts).where(eq(t.accounts.id, b.accountId)).get();
    if (!acc) return c.json({ error: "Konto nicht gefunden" }, 400);
    const row = await createProvisional(c.var.db, { accountId: b.accountId, description: merchant, rappen: -Math.round(b.amount * 100), currency: acc.currency, date: b.date, origin: "hand", categoryId: b.categoryId ?? undefined });
    return c.json({ id: row.id }, 201);
  });

  /** Kontostand eintippen. Fehlt ein Anker (noch kein Auszug mit Saldo), wird diese erste Angabe zum Anker. */
  api.put("/accounts/:id/balance", v("param", idParam), v("json", balanceEntry), async (c) => {
    const id = c.req.valid("param").id;
    const { balance } = c.req.valid("json");
    const acc = await c.var.db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
    if (!acc) return notFound(c);
    const at = nowIso();
    const day = todayInZone();
    const set: Partial<typeof t.accounts.$inferInsert> = { enteredBalance: balance, enteredDay: day, enteredAt: at, updatedAt: at };
    if (!anchorOf(acc)) Object.assign(set, { anchorBalance: balance, anchorDay: day, anchorAt: at, anchorKind: "eingabe" });
    await c.var.db.update(t.accounts).set(set).where(eq(t.accounts.id, id));
    const s = await accountSaldo(c.var.db, id);
    return c.json(s!.result);
  });

  /** Aus der Differenz eine vorläufige Sammelbuchung "Nicht erfasst" machen. */
  api.post("/accounts/:id/unrecorded", v("param", idParam), async (c) => {
    const id = c.req.valid("param").id;
    const s = await accountSaldo(c.var.db, id);
    if (!s) return notFound(c);
    if (s.result.unrecorded <= 0 || !s.result.day) return c.json({ error: "Nichts zu buchen" }, 409);
    const other = await c.var.db.select({ id: t.categories.id }).from(t.categories).where(eq(t.categories.name, "Sonstiges")).get();
    const row = await createProvisional(c.var.db, { accountId: id, description: "Nicht erfasst", rappen: -Math.round(s.result.unrecorded * 100), currency: s.acc.currency, date: s.result.day, origin: "hand", categoryId: other?.id ?? null });
    // Die Sammelbuchung gehört zum eingetippten Stand: Zeitpunkt der Eingabe nachziehen, damit sie die Differenz erklärt.
    await c.var.db.update(t.accounts).set({ enteredAt: nowIso(), updatedAt: nowIso() }).where(and(eq(t.accounts.id, id)));
    return c.json({ id: row.id }, 201);
  });

  /* ---------- Eingang per Kurzbefehl: Schlüssel und Status (die Eingangsroute selbst steht in eingang.ts) ---------- */
  api.get("/eingang", async (c) => c.json(await intakeStatus(c.var.db)));
  api.post("/eingang/schluessel", async (c) => c.json({ key: await createIntakeKey(c.var.db) }, 201));
  api.delete("/eingang/schluessel", async (c) => {
    await revokeIntakeKey(c.var.db);
    return c.json({ ok: true });
  });
  api.post("/eingang/test", async (c) => c.json(await intakeTest(c.var.db)));
}
