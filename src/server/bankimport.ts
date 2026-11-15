// Bank-Import: Datei lesen, Doppelte ausfiltern, kategorisieren, speichern, danach Paare und Rückzahlungen neu bestimmen.
// Die Rohdatei wird nicht gespeichert, nur die einzelnen Buchungen.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import * as schema from "./db/schema";
import {
  CAT, DEFAULT_RULES, applyCategories, dedupe, isMeal, learnRule, markInternalTransfers, mealShares, parseExport, parseWithMapping,
  reconcile, rowsToResult, type Bank, type Buchung, type ParseResult, type Rule,
} from "../shared/bank";
import type { ImportFilePreview, ImportPreview, ImportResult } from "../shared/schemas";
import { batch, newId, nowIso, type Db } from "./util";

const t = schema;
export interface PdfIn {
  bank: Bank;
  account?: string;
  uncertain?: number;
  confirmed?: boolean;
  rows: { date: string; description: string; amount: number; currency: string; amountChf: number; balance?: number; chfEstimated?: boolean }[];
}
type FileIn = { name: string; text?: string; mapping?: Record<string, unknown>; pdf?: PdfIn };

/** Unsichere PDF-Dateien speichert nur, wer sie bestätigt hat. */
export const unconfirmedPdf = (files: FileIn[]) => files.some((f) => f.pdf && (f.pdf.uncertain ?? 0) > 0 && !f.pdf.confirmed);

export async function loadRules(db: Db): Promise<Rule[]> {
  const rows = await db.select().from(t.categoryRules);
  // Neueste Korrektur zuerst, dann die Standardregeln
  const mine = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r): Rule => ({ pattern: r.pattern, category: r.category, ...(r.wholeWord ? { wholeWord: true } : {}) }));
  return [...mine, ...DEFAULT_RULES];
}

function readFile(f: FileIn): ParseResult {
  if (f.pdf) return rowsToResult(f.pdf);
  const text = f.text ?? "";
  return f.mapping ? parseWithMapping(text, f.mapping, { fileName: f.name }) : parseExport(text, f.name);
}

/** Liest alle Dateien und trennt neue von bereits vorhandenen Buchungen (auch zwischen den Dateien dieses Uploads). */
async function prepare(db: Db, files: FileIn[]) {
  const existing = new Set((await db.select({ h: t.transactions.hash }).from(t.transactions).where(isNotNull(t.transactions.hash))).map((r) => r.h!));
  const rules = await loadRules(db);
  const seen = new Set(existing);
  return files.map((f) => {
    const res = readFile(f);
    const { fresh, duplicates } = dedupe(seen, res.rows);
    fresh.forEach((r) => seen.add(r.hash));
    return { f, res, fresh: applyCategories(fresh, rules), duplicates };
  });
}

function preview(p: Awaited<ReturnType<typeof prepare>>[number]): ImportFilePreview {
  return {
    name: p.f.name,
    bank: p.res.bank,
    account: p.res.account ?? null,
    total: p.res.rows.length,
    fresh: p.fresh.length,
    duplicates: p.duplicates.length,
    warnings: p.res.warnings,
    needsConfirmation: !!p.res.needsConfirmation,
    header: p.res.header ?? null,
    mapping: (p.res.suggestedMapping as ImportFilePreview["mapping"]) ?? null,
    sample: p.fresh.slice(0, 5).map((r) => ({ date: r.date, description: r.description, amountChf: r.amountChf, category: r.category ?? CAT.other })),
  };
}

export async function previewImport(db: Db, files: FileIn[]): Promise<ImportPreview> {
  const ps = (await prepare(db, files)).map(preview);
  return { files: ps, fresh: ps.reduce((a, p) => a + p.fresh, 0), duplicates: ps.reduce((a, p) => a + p.duplicates, 0) };
}

/** Konto zur Kennung aus der Datei finden: erst über die Kennung, dann über den Banknamen, sonst neu anlegen. */
async function accountFor(db: Db, bank: string, ref: string | undefined): Promise<string> {
  const accs = await db.select().from(t.accounts);
  const key = (ref ?? bank).toLowerCase();
  const byRef = accs.find((a) => a.ref?.toLowerCase() === key);
  if (byRef) return byRef.id;
  const byName = accs.find((a) => !a.ref && (a.name.toLowerCase() === bank || a.bank?.toLowerCase() === bank));
  if (byName) {
    await db.update(t.accounts).set({ ref: ref ?? bank, updatedAt: nowIso() }).where(eq(t.accounts.id, byName.id));
    return byName.id;
  }
  const id = newId();
  const name = bank === "unbekannt" ? (ref ?? "Konto") : bank === "zkb" ? "ZKB" : bank.charAt(0).toUpperCase() + bank.slice(1);
  await db.insert(t.accounts).values({ id, name, bank: name, ref: ref ?? bank, sortOrder: accs.length });
  return id;
}

async function categoryIds(db: Db, names: string[]): Promise<Map<string, string>> {
  const rows = await db.select().from(t.categories);
  const map = new Map(rows.map((c) => [c.name, c.id]));
  for (const n of new Set(names)) {
    if (!map.has(n)) {
      const id = newId();
      await db.insert(t.categories).values({ id, name: n, sortOrder: map.size });
      map.set(n, id);
    }
  }
  return map;
}

/** Saldo der jüngsten Auszugszeile (CHF) als Ankersaldo des Kontos. Ein jüngerer oder gleich alter Anker wird nicht überschrieben. */
async function updateAnchor(db: Db, accountId: string, rows: Buchung[]): Promise<void> {
  let last: Buchung | undefined;
  for (const r of rows) if (r.balance !== undefined && r.currency === "CHF" && (!last || r.date >= last.date)) last = r;
  if (!last) return;
  const acc = await db.select().from(t.accounts).where(eq(t.accounts.id, accountId)).get();
  if (acc?.anchorDay && acc.anchorDay > last.date) return;
  await db.update(t.accounts).set({ anchorBalance: last.balance! / 100, anchorDay: last.date, anchorAt: null, anchorKind: "auszug", updatedAt: nowIso() }).where(eq(t.accounts.id, accountId));
}

export async function commitImport(db: Db, files: FileIn[]): Promise<ImportResult> {
  const prepared = await prepare(db, files);
  let inserted = 0;
  let matched = 0;
  for (const p of prepared) {
    if (p.res.needsConfirmation) continue;
    const accountId = await accountFor(db, p.res.bank, p.res.account);
    await updateAnchor(db, accountId, p.res.rows);
    if (!p.fresh.length) continue;
    const cats = await categoryIds(db, p.fresh.map((r) => r.category ?? CAT.other));
    // Vorläufige Buchungen desselben Kontos mit Auszugszeilen abgleichen: die Zeile gewinnt, übernimmt Kategorie und Mahlzeit-Wahl.
    const prov = await db.select().from(t.transactions).where(and(eq(t.transactions.accountId, accountId), eq(t.transactions.state, "provisional")));
    const rec = reconcile(
      prov.map((x) => ({ id: x.id, account: accountId, date: x.date, amount: Math.round(x.amount * 100), currency: x.currency, description: x.description ?? "" })),
      p.fresh.map((r) => ({ date: r.date, description: r.description, amount: r.amount, currency: r.currency, amountChf: r.amountChf })),
      { account: accountId },
    );
    const byRow = new Map(rec.matches.map((m) => [m.rowIndex, prov.find((x) => x.id === m.provisionalId)!]));
    const rows = p.fresh.map((r, i) => {
      const old = byRow.get(i);
      return {
        id: newId(),
        accountId,
        categoryId: old?.categoryId ?? cats.get(r.category ?? CAT.other) ?? null,
        date: r.date,
        amount: r.amountChf / 100,
        description: r.description,
        hash: r.hash,
        bookedAt: r.bookedAt ?? null,
        currency: r.currency,
        mealOverride: old?.mealOverride ?? r.isMeal ?? null,
      };
    });
    for (let i = 0; i < rows.length; i += 4) {
      const chunk = rows.slice(i, i + 4);
      const gone = chunk.flatMap((_, j) => byRow.get(i + j) ?? []).map((x) => x.id);
      // Einfügen und Entfernen der zugeordneten vorläufigen Buchung zusammen: nie beides oder keines von beiden sichtbar
      await batch(db, [db.insert(t.transactions).values(chunk), ...(gone.length ? [db.delete(t.transactions).where(and(inArray(t.transactions.id, gone), eq(t.transactions.state, "provisional")))] : [])]);
      matched += gone.length;
    }
    inserted += rows.length;
  }
  await recompute(db);
  const ps = prepared.map(preview);
  return { files: ps, fresh: ps.reduce((a, x) => a + x.fresh, 0), duplicates: ps.reduce((a, x) => a + x.duplicates, 0), inserted, matched };
}

/**
 * Leitet auf allen Buchungen neu ab: eigene Überweisungen (Paare über Konten), Anlage, Mahlzeiten und Rückzahlungen der Mutter.
 * Nur importierte Buchungen (mit Hash) werden angepasst. Von Hand gesetzte Werte (Kategorie, Mahlzeit) bleiben.
 */
export async function recompute(db: Db): Promise<void> {
  const [txs, cats, settings] = await Promise.all([db.select().from(t.transactions), db.select().from(t.categories), db.select().from(t.settings)]);
  if (!txs.length) return;
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const payerName = settings.find((s) => s.key === "mamaName")?.value ?? "";
  const rows: Buchung[] = txs.map((x) => {
    const rappen = Math.round(x.amount * 100);
    return {
      date: x.date, description: x.description ?? "", amount: rappen, currency: x.currency, amountChf: rappen, raw: {}, hash: x.hash ?? x.id,
      account: x.accountId, category: x.categoryId ? catName.get(x.categoryId) : undefined,
      ...(x.mealOverride !== null ? { isMeal: x.mealOverride } : {}),
    };
  });
  // Eigene Überweisungen nur unter bestätigten Buchungen suchen: eine vorläufige soll nie eine Auszugszeile zum Paar machen.
  const confirmedIdx = txs.map((_x, i) => i).filter((i) => txs[i]!.state !== "provisional");
  const pairs = markInternalTransfers(confirmedIdx.map((i) => rows[i]!));
  const marked = rows.map((r) => ({ ...r }));
  confirmedIdx.forEach((i, k) => { marked[i] = pairs[k]!; });
  const meals = mealShares(marked, { payerName: payerName || undefined });
  const stmts: unknown[] = [];
  txs.forEach((x, i) => {
    if (!x.hash && x.state !== "provisional") return; // von Hand angelegte bestätigte Buchungen nicht anfassen
    const r = marked[i]!;
    const internal = !!r.internal || r.category === CAT.invest;
    const mealOut = isMeal({ ...r, internal }) ;
    const repay = x.repaymentOverride ?? meals.repaymentRows.has(r);
    if (internal !== x.internal || mealOut !== x.mealOut || repay !== x.isRepayment) {
      stmts.push(db.update(t.transactions).set({ internal, mealOut, isRepayment: repay, updatedAt: nowIso() }).where(eq(t.transactions.id, x.id)));
    }
  });
  for (let i = 0; i < stmts.length; i += 40) await batch(db, stmts.slice(i, i + 40));
}

/** Kategorie einer Buchung geändert: Regel lernen und gleichartige unkategorisierte Buchungen nachziehen. */
export async function learnFromCorrection(db: Db, txId: string, categoryId: string): Promise<{ rule: Rule | null; updated: number }> {
  const tx = await db.select().from(t.transactions).where(eq(t.transactions.id, txId)).get();
  const cat = await db.select().from(t.categories).where(eq(t.categories.id, categoryId)).get();
  if (!tx?.description || !cat) return { rule: null, updated: 0 };
  const rule = learnRule(tx.description, cat.name);
  if (!rule) return { rule: null, updated: 0 };
  const existing = await db.select().from(t.categoryRules).where(eq(t.categoryRules.pattern, rule.pattern)).get();
  if (existing) await db.update(t.categoryRules).set({ category: rule.category, wholeWord: !!rule.wholeWord, createdAt: nowIso(), updatedAt: nowIso() }).where(eq(t.categoryRules.id, existing.id));
  else await db.insert(t.categoryRules).values({ id: newId(), pattern: rule.pattern, category: rule.category, wholeWord: !!rule.wholeWord });
  // Gleichartige Buchungen, die bisher "Sonstiges" oder keine Kategorie haben, ziehen nach.
  const other = await db.select().from(t.categories).where(eq(t.categories.name, CAT.other)).get();
  const probe = [rule].map((r) => r);
  const all = await db.select().from(t.transactions).where(and(isNotNull(t.transactions.hash)));
  const stmts: unknown[] = [];
  for (const x of all) {
    if (x.id === txId || (x.categoryId !== null && x.categoryId !== other?.id)) continue;
    const hit = applyCategories([{ date: x.date, description: x.description ?? "", amount: 0, currency: "CHF", amountChf: 0, raw: {}, hash: x.id }], probe)[0]!;
    if (hit.category === cat.name) stmts.push(db.update(t.transactions).set({ categoryId: cat.id, updatedAt: nowIso() }).where(eq(t.transactions.id, x.id)));
  }
  for (let i = 0; i < stmts.length; i += 40) await batch(db, stmts.slice(i, i + 40));
  await recompute(db);
  return { rule, updated: stmts.length };
}
