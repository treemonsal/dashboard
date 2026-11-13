// Einstieg: parseExport, parseWithMapping.
import { findHeaderRow, guessColumns, normHeader } from "./columns";
import { readCsv } from "./csv";
import { assignHashes } from "./hash";
import { parseAmount, parseDate, roundHalfUp } from "./num";
import type { Bank, Buchung, ColumnMapping, ParseOptions, ParseResult } from "./types";

export { guessColumns } from "./columns";

const REVOLUT_COLS = {
  type: ["type", "art"],
  started: ["started date", "startdatum"],
  completed: ["completed date", "abschlussdatum"],
  description: ["description", "beschreibung"],
  amount: ["amount", "betrag"],
  fee: ["fee", "gebuhr"],
  currency: ["currency", "wahrung"],
  state: ["state", "status"],
  balance: ["balance", "saldo"],
};
const REVOLUT_DONE = ["completed", "abgeschlossen"];

function findCol(header: string[], names: string[]): number | undefined {
  const norm = header.map(normHeader);
  const i = norm.findIndex((h) => names.includes(h));
  return i >= 0 ? i : undefined;
}

function isRevolutHeader(row: string[]): boolean {
  return findCol(row, REVOLUT_COLS.started) !== undefined && findCol(row, REVOLUT_COLS.completed) !== undefined && findCol(row, REVOLUT_COLS.amount) !== undefined;
}

function detectBank(hint: string): Bank {
  if (/revolut/.test(hint)) return "revolut";
  if (/(?<![a-z0-9])zkb(?![a-z0-9])|z(ü|ue|u)rcher kantonalbank/.test(hint)) return "zkb";
  if (/(?<![a-z0-9])yuh(?![a-z0-9])|swissquote/.test(hint)) return "yuh";
  return "unbekannt";
}

function detectIban(lines: string[][]): string | undefined {
  const text = lines.map((r) => r.join(" ")).join("\n");
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){3,8}\b/g)) {
    const iban = m[0].replace(/ /g, "");
    if (iban.length >= 15 && iban.length <= 34) return iban;
  }
  return undefined;
}

function rawOf(header: string[], cells: string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    let key = h || `Spalte ${i + 1}`;
    while (key in raw) key += "_2";
    raw[key] = cells[i] ?? "";
  });
  return raw;
}

interface Ctx {
  options: ParseOptions;
  warnings: string[];
  warnedCurrency: Set<string>;
}

function chf(amount: number, currency: string, ctx: Ctx): { amountChf: number; estimated?: true } {
  if (currency === "CHF") return { amountChf: amount };
  const rate = ctx.options.rates?.[currency];
  if (rate) return { amountChf: roundHalfUp(amount * rate) };
  if (!ctx.warnedCurrency.has(currency)) {
    ctx.warnedCurrency.add(currency);
    ctx.warnings.push(`Kein Kurs für ${currency}: amountChf entspricht dem Originalbetrag (chfEstimated).`);
  }
  return { amountChf: amount, estimated: true };
}

function finish(bank: Bank, account: string, rows: Buchung[], warnings: string[], header: string[]): ParseResult {
  for (const r of rows) {
    r.account = account;
  }
  assignHashes(rows, account);
  return { bank, account, rows, warnings, header };
}

function parseRevolut(table: string[][], hi: number, ctx: Ctx, account: string): ParseResult {
  const header = table[hi]!;
  const c = Object.fromEntries(Object.entries(REVOLUT_COLS).map(([k, v]) => [k, findCol(header, v)])) as Record<keyof typeof REVOLUT_COLS, number | undefined>;
  const rows: Buchung[] = [];
  let notDone = 0;
  let bad = 0;
  for (const cells of table.slice(hi + 1)) {
    const get = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? ""));
    if (c.state !== undefined && !REVOLUT_DONE.includes(normHeader(get(c.state)))) {
      notDone++;
      continue;
    }
    const started = parseDate(get(c.started));
    const completed = parseDate(get(c.completed));
    const day = started ?? completed;
    const gross = parseAmount(get(c.amount));
    if (!day || gross === null) {
      bad++;
      continue;
    }
    const fee = Math.abs(parseAmount(get(c.fee)) ?? 0);
    const amount = gross - fee;
    const currency = (get(c.currency) || "CHF").toUpperCase();
    const bal = parseAmount(get(c.balance));
    const done = completed ?? started!;
    const conv = chf(amount, currency, ctx);
    const row: Buchung = {
      date: day.date,
      bookedAt: done.time ? `${done.date}T${done.time}` : done.date,
      description: get(c.description).replace(/\s+/g, " ").trim() || "(ohne Text)",
      amount,
      currency,
      amountChf: conv.amountChf,
      raw: rawOf(header, cells),
      hash: "",
    };
    if (conv.estimated) row.chfEstimated = true;
    if (bal !== null) row.balance = bal;
    rows.push(row);
  }
  if (notDone) ctx.warnings.push(`${notDone} nicht abgeschlossene Revolut-Buchungen (pending, storniert, abgelehnt) ignoriert.`);
  if (bad) ctx.warnings.push(`${bad} Revolut-Zeilen ohne lesbares Datum oder Betrag übersprungen.`);
  return finish("revolut", account, rows, ctx.warnings, header);
}

function parseGeneric(table: string[][], hi: number, m: ColumnMapping, bank: Bank, ctx: Ctx, account: string): ParseResult {
  const header = table[hi]!;
  const rows: Buchung[] = [];
  const descCols = m.description === undefined ? [] : Array.isArray(m.description) ? m.description : [m.description];
  let badDate = 0;
  let badAmount = 0;
  for (const cells of table.slice(hi + 1)) {
    const get = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? ""));
    const d = parseDate(get(m.date));
    if (!d) {
      badDate++;
      continue;
    }
    let amount: number | null = null;
    if (m.amount !== undefined) amount = parseAmount(get(m.amount));
    if (amount === null && (m.debit !== undefined || m.credit !== undefined)) {
      const deb = parseAmount(get(m.debit));
      const cre = parseAmount(get(m.credit));
      if (deb !== null || cre !== null) amount = (cre !== null ? Math.abs(cre) : 0) - (deb !== null ? Math.abs(deb) : 0);
    }
    if (amount === null) {
      badAmount++;
      continue;
    }
    const currency = (m.currency !== undefined ? get(m.currency) : "").toUpperCase() || m.defaultCurrency || "CHF";
    let conv = chf(amount, currency, ctx);
    if (m.amountChf !== undefined && currency !== "CHF") {
      const v = parseAmount(get(m.amountChf));
      if (v !== null) conv = { amountChf: amount < 0 ? -Math.abs(v) : Math.abs(v) };
    }
    const description = descCols.map((i) => get(i)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const counterparty = get(m.counterparty).trim();
    const bal = parseAmount(get(m.balance));
    const row: Buchung = {
      date: d.date,
      description: description || counterparty || "(ohne Text)",
      amount,
      currency,
      amountChf: conv.amountChf,
      raw: rawOf(header, cells),
      hash: "",
    };
    if (d.time) row.bookedAt = `${d.date}T${d.time}`;
    if (m.valuta !== undefined && m.valuta !== m.date) {
      const v = parseDate(get(m.valuta));
      if (v) row.bookedAt = v.time ? `${v.date}T${v.time}` : v.date;
    }
    if (conv.estimated) row.chfEstimated = true;
    if (counterparty) row.counterparty = counterparty;
    if (bal !== null) row.balance = bal;
    rows.push(row);
  }
  if (badDate) ctx.warnings.push(`${badDate} Zeilen ohne gültiges Datum übersprungen (Summenzeilen o.ä.).`);
  if (badAmount) ctx.warnings.push(`${badAmount} Zeilen ohne lesbaren Betrag übersprungen.`);
  return finish(bank, account, rows, ctx.warnings, header);
}

function hintText(fileName: string | undefined, table: string[][], hi: number): string {
  const pre = table.slice(0, Math.max(hi, 0)).map((r) => r.join(" "));
  return [fileName ?? "", ...pre, (table[hi] ?? []).join(" ")].join("\n").toLowerCase();
}

function context(options: ParseOptions): Ctx {
  return { options, warnings: [], warnedCurrency: new Set() };
}

export function parseExport(text: string, fileName?: string, options: ParseOptions = {}): ParseResult {
  const { table, delimiter } = readCsv(text);
  const ctx = context(options);
  if (table.length < 2) return { bank: detectBank((fileName ?? "").toLowerCase()), rows: [], warnings: ["Datei ist leer oder enthält keine Tabelle."] };

  const rev = table.slice(0, 80).findIndex(isRevolutHeader);
  if (rev >= 0) {
    const account = options.account ?? detectIban(table.slice(0, rev)) ?? "revolut";
    return parseRevolut(table, rev, ctx, account);
  }

  const hi = findHeaderRow(table);
  const bank = detectBank(hintText(fileName, table, hi));
  if (hi < 0) {
    return {
      bank,
      rows: [],
      warnings: ["Keine Kopfzeile erkannt. Bitte Spalten manuell zuordnen."],
      needsConfirmation: true,
      suggestedMapping: { delimiter },
    };
  }
  const guess = guessColumns(table[hi]!);
  const mapping: ColumnMapping = { ...guess.mapping, headerRow: hi, delimiter };
  if (!guess.confident) {
    return {
      bank,
      rows: [],
      warnings: [`Spalten nicht sicher erkannt (es fehlt: ${guess.missing.join(", ")}). Bitte Zuordnung bestätigen.`],
      needsConfirmation: true,
      suggestedMapping: mapping,
      header: table[hi],
    };
  }
  const account = options.account ?? detectIban(table.slice(0, hi)) ?? bank;
  const res = parseGeneric(table, hi, mapping, bank, ctx, account);
  if (bank === "unbekannt") res.warnings.unshift("Bank nicht erkannt, generische Spaltenerkennung verwendet.");
  res.suggestedMapping = mapping;
  return res;
}

/** Liest die Datei mit einer (von der Oberfläche bestätigten) Spaltenzuordnung. */
export function parseWithMapping(text: string, mapping: ColumnMapping, options: ParseOptions = {}): ParseResult {
  const { table, delimiter } = readCsv(text, mapping.delimiter);
  const ctx = context(options);
  const hi = mapping.headerRow ?? Math.max(findHeaderRow(table), 0);
  if (!table[hi]) return { bank: "unbekannt", rows: [], warnings: ["Kopfzeile nicht gefunden."] };
  const bank = detectBank(hintText(options.fileName, table, hi));
  if (mapping.date === undefined || mapping.description === undefined || (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined)) {
    return { bank, rows: [], warnings: ["Zuordnung unvollständig: Datum, Text und Betrag (oder Soll/Haben) nötig."], needsConfirmation: true, suggestedMapping: mapping };
  }
  const account = options.account ?? detectIban(table.slice(0, hi)) ?? bank;
  const res = parseGeneric(table, hi, { ...mapping, delimiter }, bank, ctx, account);
  res.suggestedMapping = { ...mapping, headerRow: hi, delimiter };
  return res;
}
