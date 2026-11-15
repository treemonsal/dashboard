// PDF-Kontoauszug (Revolut u.a.): reine Funktionen über Textstücke und Zeilen. Kein I/O, läuft im Browser wie im Worker.
//
// Ablauf: Textstücke mit Position (pdf.js) -> groupLines -> parsePdf -> ParseResult (wie parseExport).
// Ehrlich statt geraten: Stimmt die Saldo-Kette nicht oder werden weniger als 80 Prozent der Zeilen mit Datum als Buchung
// erkannt, steht `uncertain` > 0 und eine Warnung in `warnings`; die Oberfläche speichert dann nur nach Bestätigung.
import { assignHashes } from "./hash";
import { parseAmount } from "./num";
import type { Bank, Buchung, ParseOptions, ParseResult } from "./types";

/** Ein Textstück aus dem PDF. y wächst nach oben (PDF-Koordinaten), w ist die Breite. */
export interface PdfItem {
  page: number;
  x: number;
  y: number;
  w?: number;
  text: string;
}
export interface PdfCell {
  x: number;
  /** rechte Kante */
  x2: number;
  text: string;
}
export interface PdfLine {
  page: number;
  y: number;
  cells: PdfCell[];
  /** Zellen mit einem Leerzeichen verbunden */
  text: string;
}
export interface PdfStats {
  /** Zeilen, die mit einem Datum beginnen (ohne Kopfzeilen) */
  dated: number;
  /** davon als Buchung mit Betrag erkannt */
  recognized: number;
  /** Buchungen, deren Saldo nicht zur Kette passt */
  chainBreaks: number;
  /** Buchungen mit Saldo (Kette prüfbar) */
  chainChecked: number;
  /** Buchungen, deren Vorzeichen nicht sicher bestimmt werden konnte */
  unsignedGuess: number;
}
export interface PdfParse extends ParseResult {
  stats: PdfStats;
}

/* ---------- Textstücke zu Zeilen ---------- */

/**
 * Gleiche y-Lage (Toleranz) ergibt eine Zeile; Stücke nach x sortiert. Stücke, die weniger als `gap` auseinander liegen,
 * gehören zu einer Zelle (ein Wort pro Stück ist üblich), grössere Lücken trennen Spalten.
 */
export function groupLines(items: PdfItem[], opts: { yTol?: number; gap?: number } = {}): PdfLine[] {
  const yTol = opts.yTol ?? 2.5;
  const gap = opts.gap ?? 6;
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const out: PdfLine[] = [];
  for (const page of pages) {
    const its = items.filter((i) => i.page === page && i.text.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfItem[][] = [];
    for (const it of its) {
      const row = rows.find((r) => Math.abs(r[0]!.y - it.y) <= yTol);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0]!.y - a[0]!.y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const cells: PdfCell[] = [];
      for (const it of row) {
        const t = it.text.trim();
        const w = it.w ?? t.length * 4.5;
        const cell: PdfCell = { x: it.x, x2: it.x + w, text: t };
        const last = cells.at(-1);
        // Auch bei kleiner Lücke trennen, wenn ein Datum oder ein Betrag an Text stösst (enge Spalten bei ZKB und Yuh).
        // Währung, Minus oder Klammer gehören dagegen zum Betrag.
        const split =
          last &&
          it.x - last.x2 > 0.5 &&
          (isDateOnly(last.text) ||
            isDateOnly(t) ||
            (asNumber(last) !== null && !/^(CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD|-|\))$/i.test(t)) ||
            (asNumber(cell) !== null && !/^([-+−(]|CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD|S?Fr\.?)$/i.test(last.text.trim())));
        if (last && it.x - last.x2 <= gap && !split) {
          last.text += (it.x - last.x2 > 0.8 || !/\s$/.test(last.text) ? " " : "") + t;
          last.x2 = Math.max(last.x2, it.x + w);
        } else cells.push(cell);
      }
      out.push({ page, y: row[0]!.y, cells, text: cells.map((c) => c.text).join(" ") });
    }
  }
  return out;
}

/** Erkannter Text zum Kopieren (Positionen in Klammern), damit ein Layout, das nicht passt, nachgebaut werden kann. */
export function pdfText(lines: PdfLine[]): string {
  let page = 0;
  const out: string[] = [];
  for (const l of lines) {
    if (l.page !== page) {
      page = l.page;
      out.push(`--- Seite ${page} ---`);
    }
    out.push(l.cells.map((c) => `[${Math.round(c.x)}-${Math.round(c.x2)}] ${c.text}`).join("  "));
  }
  return out.join("\n");
}

/* ---------- Datum ---------- */

// Deutsch, Englisch, Französisch (Yuh und ZKB schreiben je nach Spracheinstellung), dazu "gen" (italienisch).
const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, janvier: 1, gen: 1,
  feb: 2, februar: 2, february: 2, fevr: 2, févr: 2,
  mar: 3, mär: 3, maer: 3, mrz: 3, märz: 3, maerz: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6, juin: 6,
  jul: 7, juli: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8, août: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dez: 12, dezember: 12, dec: 12, december: 12, déc: 12,
};
const MON = "[A-Za-zÄäÖöÜüÉéÛû]{3,9}";
const pad2 = (n: number) => String(n).padStart(2, "0");
function valid(y: number, m: number, d: number): boolean {
  // Jahre ausserhalb 1990 bis 2100 sind Nummern (Karten, Referenzen), kein Datum.
  return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const iso = (y: number, m: number, d: number) => (valid(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null);

/** Datum am Anfang eines Textes: 01.10.2026, 1. Okt. 2026, 01 Oct 2026, Oct 1, 2026, 2026-10-01. Liefert Datum und Länge. */
export function matchDate(s: string): { date: string; len: number } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
  if (m) {
    const d = iso(+m[1]!, +m[2]!, +m[3]!);
    return d ? { date: d, len: m[0].length } : null;
  }
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(s);
  if (m) {
    const d = iso(+m[3]!, +m[2]!, +m[1]!);
    return d ? { date: d, len: m[0].length } : null;
  }
  // Zweistelliges Jahr (01.10.26) nur, wenn danach nichts Zahlartiges folgt.
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2})(?=$|\s)/.exec(s);
  if (m) {
    const d = iso(2000 + +m[3]!, +m[2]!, +m[1]!);
    return d ? { date: d, len: m[0].length } : null;
  }
  m = new RegExp(`^(\\d{1,2})\\.?\\s+(${MON})\\.?,?\\s+(\\d{4}|\\d{2})(?!\\d)`).exec(s);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const d = mo ? iso(y, mo, +m[1]!) : null;
    return d ? { date: d, len: m[0].length } : null;
  }
  m = new RegExp(`^(${MON})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4}|\\d{2})(?!\\d)`).exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const d = mo ? iso(y, mo, +m[2]!) : null;
    return d ? { date: d, len: m[0].length } : null;
  }
  return null;
}

/** Text ist genau ein Datum (nichts davor oder danach). */
export function isDateOnly(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const m = matchDate(t);
  return !!m && m.len === t.length;
}

/* ---------- Spalten ---------- */

type Col = "date" | "valuta" | "desc" | "out" | "in" | "amount" | "balance";
interface Anchor {
  col: Col;
  x: number;
  x2: number;
}
const HEADER_WORDS: [Col, RegExp][] = [
  ["date", /^(datum|date|buchungsdatum|buchung|buchungstag|transaktionsdatum|booking date|transaction date)$/],
  ["valuta", /^(valuta|valutadatum|value date|valuedate|date valeur)$/],
  ["desc", /^(beschreibung|description|text|buchungstext|details|verwendungszweck|art der kontobewegung|kontobewegung|transaktion|transaktionen|transaction|transactions|transaction type|activity|aktivität|aktivitaet|buchungsdetails|mitteilung|vorgang)$/],
  ["out", /^(ausgehend|geldausgang|money out|belastung|belastungen|ausgaben|ausgabe|soll|paid out|debit|abbuchung|ausgang|withdrawal|lastschrift)$/],
  ["in", /^(eingehend|geldeingang|money in|gutschrift|gutschriften|einnahmen|einnahme|haben|paid in|credit|eingang|deposit)$/],
  ["amount", /^(betrag|amount|umsatz|betrag detail)$/],
  ["balance", /^(saldo|balance|kontostand|neuer saldo)$/],
];

/**
 * Kopfzeile mit Spaltenüberschriften: mindestens zwei verschiedene, darunter Datum oder Text und eine Betrags- oder
 * Saldospalte. Überschriften dürfen über bis zu drei Zellen gehen ("Art der Kontobewegung"), Währungszusätze wie
 * "Betrag (CHF)" oder "in CHF" zählen nicht. Valuta gilt als Datum, wenn es keine eigene Datumsspalte gibt.
 */
export function findHeader(line: PdfLine): Anchor[] | null {
  const found: Anchor[] = [];
  const c = line.cells;
  for (let i = 0; i < c.length; i++) {
    for (const span of [3, 2, 1]) {
      if (i + span > c.length) continue;
      const slice = c.slice(i, i + span);
      const t = slice.map((x) => x.text).join(" ").toLowerCase().replace(/\b(in\s+)?(chf|eur|usd|gbp)\b/g, "").replace(/[():.,/]/g, " ").replace(/\s+/g, " ").trim();
      const hit = HEADER_WORDS.find(([, re]) => re.test(t));
      if (hit) {
        found.push({ col: hit[0], x: slice[0]!.x, x2: slice.at(-1)!.x2 });
        i += span - 1;
        break;
      }
    }
  }
  if (!found.some((f) => f.col === "date")) {
    const v = found.find((f) => f.col === "valuta");
    if (v) v.col = "date";
  }
  const kinds = new Set(found.map((f) => f.col));
  if (kinds.size < 2 || !(kinds.has("date") || kinds.has("desc")) || !(kinds.has("out") || kinds.has("in") || kinds.has("amount") || kinds.has("balance"))) return null;
  return found;
}

/* ---------- Beträge ---------- */

const CUR = /(?:^|\b)(CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD)(?:\b|(?=\d)|$)/i;
interface Num {
  rappen: number;
  cur?: string;
  cell: PdfCell;
  /** Vorzeichen stand im Text */
  signed: boolean;
}

/**
 * Eine Zelle als Betrag lesen. Verlangt zwei Nachkommastellen und saubere Tausendergruppen, damit Nummern, Daten und
 * Hausnummern nie als Betrag gelten. Beträge über einer Milliarde Franken sind Kennungen, keine Buchungen.
 */
function asNumber(cell: PdfCell): Num | null {
  const t = cell.text.trim();
  if (!t || isDateOnly(t)) return null;
  const cur = CUR.exec(t)?.[1]?.toUpperCase();
  const bare = t.replace(/\b(CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD|S?Fr\.?)\b/gi, "").replace(/[€$£]/g, "").trim();
  const core = bare.replace(/^\((.*)\)$/, "$1").replace(/^[-+−]\s*|\s*-\s*$/g, "").trim();
  if (!/^(?:\d{1,3}(?:['’ʼ´`\s\u00A0\u202F.,]\d{3})+|\d{1,9})[.,]\d{2}$/.test(core)) return null;
  const v = parseAmount(bare);
  if (v === null || Math.abs(v) > 100_000_000_000) return null;
  return { rappen: v, cur, cell, signed: /^[-+−(]|-\s*$|\)$/.test(bare) };
}

/* ---------- Seitenköpfe, Summen ---------- */

const JUNK =
  /^(seite|page)\s+\d+(\s+(von|of|\/)\s+\d+)?$|^(chf-kontoauszug|eur-kontoauszug|usd-kontoauszug|kontoauszug|account statement|statement|auszug|kontoübersicht|account summary|bilanz-zusammenfassung|kontotransaktionen|transaktionen|transactions)\b|\b(iban|bic|swift)\b|^(total|summe|gesamt|gesamtsumme|umsatztotal|zwischensumme|übertrag|uebertrag|subtotal|carried forward|brought forward)\b|^(anfangssaldo|eröffnungssaldo|eroeffnungssaldo|saldovortrag|vortragssaldo|alter saldo|neuer saldo|endsaldo|schlusssaldo|saldo (zu beginn|am ende|vortrag|zu ihren gunsten|zu ihren lasten|per )|opening balance|closing balance|starting balance|ending balance|balance (at|on|brought|carried) )|revolut (bank|ltd)|z(ü|ue|u)rcher kantonalbank|swissquote|einlagensicherung|autorisierungscode|verlorene oder gestohlene karte|hilfe direkt in der app|scanne den qr|der saldo auf deinem kontoauszug|ausstehende transaktionen|bitte prüfen sie|generiert|generated|erstellt am|^www\.|^©|^(zeitraum|period)\b/i;
/** Anfangssaldo als Text am Zeilenanfang; der Betrag steht in derselben Zeile. */
const OPENING = /^(anfangssaldo|eröffnungssaldo|eroeffnungssaldo|saldovortrag|vortragssaldo|alter saldo|saldo (zu beginn|vortrag|per beginn)|opening balance|starting balance|balance brought forward)\b/i;
/** Schlusssaldo, Summen und Überträge: keine Buchung, beenden die laufende Beschreibung. */
const CLOSING = /^(endsaldo|schlusssaldo|neuer saldo|saldo$|saldo (am ende|zu ihren gunsten|zu ihren lasten|per ende)|closing balance|ending balance|balance carried forward|total|summe|gesamt|gesamtsumme|umsatztotal|zwischensumme|übertrag|uebertrag)\b/i;
/** Überschrift einer Saldo-Tabelle (Yuh): der Betrag steht in der nächsten Zeile unter dieser Zelle. */
const OPENING_LABEL = /^(eröffnungssaldo|eroeffnungssaldo|anfangssaldo|saldovortrag|opening balance|starting balance)$/i;

/* ---------- Parser ---------- */

interface Raw {
  date: string;
  desc: string;
  /** Betrag ohne Vorzeichen, Rappen */
  abs: number;
  /** +1 Eingang, -1 Ausgang, 0 unbekannt */
  sign: -1 | 0 | 1;
  balance?: number;
  cur?: string;
  text: string;
}

/** Bank aus dem ganzen Text und dem Dateinamen (Yuh nennt sich oft erst in der Fusszeile). */
function detectBank(text: string, fileName = ""): Bank {
  const t = `${text}\n${fileName}`;
  if (/revolut/i.test(t)) return "revolut";
  if (/(?<![a-z0-9])zkb(?![a-z0-9])|z(ü|ue|u)rcher kantonalbank/i.test(t)) return "zkb";
  if (/(?<![a-z0-9])yuh(?![a-z0-9])|swissquote/i.test(t)) return "yuh";
  return "unbekannt";
}
function detectIban(text: string): string | undefined {
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){3,8}\b/g)) {
    const iban = m[0].replace(/ /g, "");
    if (iban.length >= 15 && iban.length <= 34) return iban;
  }
  return undefined;
}

/** Spalte einer Zahl über die Lage: Abstand der linken oder der rechten Kante zur Überschrift, je kleiner. */
function columnOf(n: Num, anchors: Anchor[]): Col | null {
  const money = anchors.filter((a) => a.col === "out" || a.col === "in" || a.col === "amount" || a.col === "balance");
  let best: Anchor | null = null;
  let bd = Infinity;
  for (const a of money) {
    const d = Math.min(Math.abs(n.cell.x - a.x), Math.abs(n.cell.x2 - a.x2), Math.abs((n.cell.x + n.cell.x2) / 2 - (a.x + a.x2) / 2));
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best && bd <= 65 ? best.col : null;
}

/**
 * Zellen auftrennen, die pdf.js zusammengefasst hat: ein Datum am Anfang ("01.10.2026 Migros") und bis zu drei Daten
 * oder Beträge am Ende ("Migros 12.30 1'234.50"). Die x-Lage wird anteilig nach Zeichen geschätzt.
 */
function splitCells(cells: PdfCell[]): PdfCell[] {
  const out: PdfCell[] = [];
  for (const orig of cells) {
    let c: PdfCell = { x: orig.x, x2: orig.x2, text: orig.text.trim() };
    if (!c.text) continue;
    if (!isDateOnly(c.text) && !asNumber(c)) {
      const dm = matchDate(c.text);
      if (dm && dm.len < c.text.length && /^\s/.test(c.text.slice(dm.len))) {
        const left = c.text.slice(0, dm.len).trim();
        const right = c.text.slice(dm.len).trim();
        const mid = c.x + (c.x2 - c.x) * (dm.len / Math.max(1, c.text.length));
        out.push({ x: c.x, x2: mid, text: left });
        c = { x: mid, x2: c.x2, text: right };
      }
    }
    const tail: PdfCell[] = [];
    for (let k = 0; k < 3 && !isDateOnly(c.text) && !asNumber(c); k++) {
      const m =
        /^(.*?)\s+(\d{1,2}[./]\d{1,2}[./](?:\d{4}|\d{2})|[-+−(]?(?:(?:CHF|EUR|USD|GBP)\s*)?(?:\d{1,3}(?:['’ʼ´`.,]\d{3})+|\d{1,9})[.,]\d{2}-?\)?(?:\s*(?:CHF|EUR|USD|GBP))?)$/i.exec(
          c.text,
        );
      if (!m) break;
      const head = m[1]!.trim();
      const last = m[2]!.trim();
      if (!head) break;
      const mid = c.x + (c.x2 - c.x) * (head.length / Math.max(1, c.text.length));
      const part: PdfCell = { x: mid, x2: c.x2, text: last };
      if (!isDateOnly(last) && !asNumber(part)) break;
      tail.unshift(part);
      c = { x: c.x, x2: mid, text: head };
    }
    if (c.text) out.push(c);
    out.push(...tail);
  }
  return out;
}

/**
 * Zahlen von rechts einsammeln (höchstens 3). Ein zweites Datum (Valuta) am Anfang oder am Ende und eine allein
 * stehende Währung werden übersprungen; die Währung gilt dann für die Zeile.
 */
function takeNumbers(cells: PdfCell[]): { rest: PdfCell[]; nums: Num[]; cur?: string } {
  const rest = splitCells(cells);
  if (rest.length && isDateOnly(rest[0]!.text)) rest.shift();
  const nums: Num[] = [];
  let cur: string | undefined;
  while (rest.length && nums.length < 3) {
    const last = rest.at(-1)!;
    const n = asNumber(last);
    if (n) {
      nums.unshift(n);
      rest.pop();
      continue;
    }
    if (isDateOnly(last.text)) {
      rest.pop();
      continue;
    }
    const cm = /^(CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD)$/i.exec(last.text.trim());
    if (cm) {
      cur = cm[1]!.toUpperCase();
      rest.pop();
    } else break;
  }
  return { rest, nums, cur };
}

/** Betrag, Saldo und Vorzeichen aus den Zahlen einer Zeile. `onlyBalance`: die Zeile hat nur einen Saldo (Saldo-Zeile). */
function pickAmount(nums: Num[], anchors: Anchor[]): { amountNum?: Num; balance?: number; sign: -1 | 0 | 1; onlyBalance: boolean } {
  let balance: number | undefined;
  let amountNum: Num | undefined;
  let sign: -1 | 0 | 1 = 0;
  let onlyBalance = false;
  if (anchors.length) {
    const by = nums.map((n) => ({ n, col: columnOf(n, anchors) }));
    const bal = by.find((b) => b.col === "balance");
    if (bal) balance = bal.n.rappen;
    const out = by.find((b) => b.col === "out");
    const inn = by.find((b) => b.col === "in");
    const amt = by.find((b) => b.col === "amount");
    if (out && !inn) {
      amountNum = out.n;
      sign = -1;
    } else if (inn && !out) {
      amountNum = inn.n;
      sign = 1;
    } else if (amt) {
      amountNum = amt.n;
      sign = amt.n.signed ? (amt.n.rappen < 0 ? -1 : 1) : 0;
    }
    if (!amountNum) {
      if (bal && nums.length === 1) onlyBalance = true;
      else {
        // Lage passt zu keiner Spalte: Reihenfolge Betrag, Saldo
        const rest2 = nums.filter((n) => n !== bal?.n);
        if (rest2.length === 1) amountNum = rest2[0];
        if (amountNum?.signed) sign = amountNum.rappen < 0 ? -1 : 1;
      }
    }
  } else {
    if (nums.length >= 2) {
      balance = nums.at(-1)!.rappen;
      amountNum = nums.at(-2)!;
    } else amountNum = nums[0];
    if (amountNum?.signed) sign = amountNum.rappen < 0 ? -1 : 1;
  }
  return { amountNum, balance, sign, onlyBalance };
}

export function parsePdf(lines: PdfLine[], options: ParseOptions = {}): PdfParse {
  const warnings: string[] = [];
  const head = lines.slice(0, 40).map((l) => l.text).join("\n");
  const all = lines.map((l) => l.text).join("\n");
  const bank = detectBank(all, options.fileName);
  const iban = detectIban(all);
  const account = options.account ?? iban ?? bank;

  const raws: Raw[] = [];
  let anchors: Anchor[] = [];
  let opening: number | undefined;
  /** Lage der Überschrift "Eröffnungssaldo"; der Betrag folgt in der nächsten Zeile darunter */
  let openingAnchor: { x: number; x2: number } | null = null;
  let cur: Raw | null = null;
  /** Zeile mit Datum und Text, aber ohne Betrag: der Betrag kann in der nächsten Zeile stehen (Yuh, zweizeilig) */
  let pending: { date: string; desc: string; text: string } | null = null;
  let dated = 0;
  let page = -1;
  let pageHasRow = false;

  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      pageHasRow = false;
      cur = null; // Beschreibungen laufen nicht über Seitenumbrüche (Kopf und Fuss stehen dazwischen)
      pending = null;
      openingAnchor = null;
    }
    const hdr = findHeader(line);
    if (hdr) {
      anchors = hdr;
      cur = null;
      pending = null;
      openingAnchor = null;
      continue;
    }
    const text = line.text;
    const dm = matchDate(text);
    if (!dm) {
      const label = line.cells.find((c) => OPENING_LABEL.test(c.text.trim()));
      if (label) {
        openingAnchor = { x: label.x, x2: label.x2 };
        cur = null;
        continue;
      }
      if (opening === undefined && openingAnchor) {
        for (const c of line.cells) {
          const n = asNumber(c);
          if (n && Math.min(Math.abs(c.x - openingAnchor.x), Math.abs(c.x2 - openingAnchor.x2)) <= 45) {
            opening = n.rappen;
            break;
          }
        }
        openingAnchor = null;
      }
      if (OPENING.test(text.trim())) {
        const nums = line.cells.map(asNumber).filter((x): x is Num => !!x);
        if (nums.length) opening = nums[0]!.rappen;
        cur = null;
        pending = null;
        continue;
      }
      if (JUNK.test(text.trim()) || CLOSING.test(text.trim())) {
        cur = null;
        pending = null;
        continue;
      }
      if (pending) {
        // Zweite Zeile einer zweizeiligen Buchung: Betrag (und Saldo) stehen hier
        const { rest, nums, cur: lineCur } = takeNumbers(line.cells);
        if (nums.length) {
          const { amountNum, balance, sign } = pickAmount(nums, anchors);
          if (amountNum) {
            const more = rest.map((c) => c.text).join(" ").trim();
            const desc = [pending.desc, more].filter(Boolean).join(" ").trim().slice(0, 400);
            cur = {
              date: pending.date,
              desc,
              abs: Math.abs(amountNum.rappen),
              sign,
              balance,
              cur: amountNum.cur ?? nums.find((n) => n.cur)?.cur ?? lineCur,
              text: `${pending.text} ${text}`.trim(),
            };
            raws.push(cur);
            pageHasRow = true;
            pending = null;
            continue;
          }
        }
        const extra = line.cells.map((c) => c.text).join(" ").trim();
        if (extra && pending.desc.length < 300) pending.desc = `${pending.desc} ${extra}`.trim().slice(0, 400);
        continue;
      }
      // Fortsetzung der Beschreibung: nur Text, keine Zahlen in den Betragsspalten
      if (cur && pageHasRow && cur.desc.length < 300) {
        const extra = line.cells.filter((c) => !asNumber(c) || (anchors.length && columnOf(asNumber(c)!, anchors) === null)).map((c) => c.text).join(" ").trim();
        if (extra) cur.desc = `${cur.desc} ${extra}`.trim().slice(0, 400);
      }
      continue;
    }
    // Zeile beginnt mit Datum: Zellen nach dem Datum
    let consumed = dm.len;
    const rest: PdfCell[] = [];
    let off = 0;
    for (const c of line.cells) {
      const start = off;
      const end = off + c.text.length;
      off = end + 1;
      if (end <= consumed) continue;
      if (start < consumed) {
        const t = c.text.slice(consumed - start).trim();
        if (t) rest.push({ x: c.x + (c.x2 - c.x) * ((consumed - start) / Math.max(1, c.text.length)), x2: c.x2, text: t });
      } else rest.push(c);
    }
    const { rest: restCells, nums, cur: lineCur } = takeNumbers(rest);
    const desc = restCells.map((c) => c.text).join(" ").trim().slice(0, 400);
    // Zeitraum ("01.10.2026 - 31.10.2026", "bis"): Kopf, keine Buchung
    if (/^([-–—]|bis\b|to\b)/i.test(desc)) {
      cur = null;
      pending = null;
      continue;
    }
    if (OPENING.test(desc)) {
      if (opening === undefined && nums.length) opening = nums.at(-1)!.rappen;
      cur = null;
      pending = null;
      continue;
    }
    if (CLOSING.test(desc) || JUNK.test(desc)) {
      cur = null;
      pending = null;
      continue;
    }
    if (!nums.length) {
      dated++;
      cur = null;
      pending = desc ? { date: dm.date, desc, text } : null;
      continue;
    }
    const { amountNum, balance, sign, onlyBalance } = pickAmount(nums, anchors);
    if (onlyBalance) {
      // Datum und nur ein Saldo (Saldo-Zeile vor der ersten Buchung): Startsaldo, keine Buchung
      if (raws.length === 0 && opening === undefined && balance !== undefined) opening = balance;
      cur = null;
      pending = null;
    } else {
      dated++;
      pending = null;
      if (amountNum) {
        cur = { date: dm.date, desc, abs: Math.abs(amountNum.rappen), sign, balance, cur: amountNum.cur ?? nums.find((n) => n.cur)?.cur ?? lineCur, text };
        raws.push(cur);
        pageHasRow = true;
      } else cur = null;
    }
  }

  // Reihenfolge: neueste zuerst oder älteste zuerst? Die Saldo-Kette entscheidet (bei Gleichstand wie im PDF).
  const consistency = (rs: Raw[]) => {
    let ok = 0;
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1]!.balance;
      const b = rs[i]!.balance;
      if (a !== undefined && b !== undefined && Math.abs(b - a) === rs[i]!.abs) ok++;
    }
    return ok;
  };
  const forward = raws;
  const reversed = [...raws].reverse();
  const ordered = consistency(reversed) > consistency(forward) ? reversed : forward;
  const wasReversed = ordered === reversed && raws.length > 1;

  // Vorzeichen und Kette. Der Startsaldo zählt nur, wenn er zur ersten Buchung passt (sonst gehört er zu einem anderen Konto).
  let unsignedGuess = 0;
  let chainBreaks = 0;
  let chainChecked = 0;
  let prev: number | undefined =
    opening !== undefined && (ordered[0]?.balance === undefined || Math.abs(ordered[0]!.balance - opening) === ordered[0]!.abs) ? opening : undefined;
  const rows: Buchung[] = [];
  const defaultCur = (CUR.exec(head)?.[1] ?? "CHF").toUpperCase();
  const warnedCur = new Set<string>();
  for (const r of ordered) {
    let sign = r.sign;
    if (sign === 0 && prev !== undefined && r.balance !== undefined) {
      const diff = r.balance - prev;
      if (Math.abs(diff) === r.abs && r.abs !== 0) sign = diff > 0 ? 1 : -1;
    }
    if (sign === 0) {
      unsignedGuess++;
      sign = -1; // ohne Hinweis zählt es als Ausgabe; die Zeile ist als unsicher gezählt
    }
    const amount = sign * r.abs;
    if (r.balance !== undefined) {
      if (prev !== undefined) {
        chainChecked++;
        if (prev + amount !== r.balance) chainBreaks++;
      }
      prev = r.balance;
    } else if (prev !== undefined) prev += amount;
    const currency = r.cur ?? defaultCur;
    let amountChf = amount;
    let estimated = false;
    if (currency !== "CHF") {
      const rate = options.rates?.[currency];
      if (rate) amountChf = Math.round(amount * rate);
      else {
        estimated = true;
        if (!warnedCur.has(currency)) {
          warnedCur.add(currency);
          warnings.push(`Kein Kurs für ${currency}: amountChf entspricht dem Originalbetrag (chfEstimated).`);
        }
      }
    }
    rows.push({
      date: r.date,
      description: r.desc.slice(0, 400),
      amount,
      currency,
      amountChf,
      ...(r.balance !== undefined ? { balance: r.balance } : {}),
      raw: { Zeile: r.text },
      hash: "",
      account,
      ...(estimated ? { chfEstimated: true } : {}),
    });
  }
  assignHashes(rows, account);

  const recognized = rows.length;
  const notRecognized = dated - recognized;
  const uncertainRows = notRecognized + chainBreaks + unsignedGuess;
  if (dated === 0) warnings.push("Im PDF wurde keine Zeile mit Datum gefunden. Ist es ein gescanntes Bild oder ein anderes Layout?");
  else {
    if (notRecognized > 0 && recognized / dated < 0.8) warnings.push(`Nur ${recognized} von ${dated} Zeilen mit Datum wurden als Buchung erkannt (${notRecognized} unsicher).`);
    if (chainBreaks > 0) warnings.push(`Die Saldo-Kette stimmt bei ${chainBreaks} von ${chainChecked} Buchungen nicht: Beträge oder Vorzeichen sind unsicher.`);
    if (unsignedGuess > 0) warnings.push(`Bei ${unsignedGuess} Buchungen ist das Vorzeichen nicht sicher (kein Saldo, keine Spalte).`);
    if (chainChecked === 0 && recognized > 0) warnings.push("Kein Saldo im Auszug: Beträge lassen sich nicht gegen eine Saldo-Kette prüfen.");
  }
  if (wasReversed) warnings.push("Der Auszug steht mit der neuesten Buchung zuerst; die Reihenfolge wurde gedreht.");
  // Unsicher heisst: Bestätigung nötig. Die Warnungen stehen in der Vorschau, nichts wird ohne Bestätigung gespeichert.
  const blocking = dated === 0 || (dated > 0 && (recognized / dated < 0.8 || chainBreaks > 0)) || unsignedGuess > 0;
  const uncertain = blocking ? Math.max(1, dated === 0 ? 1 : uncertainRows) : 0;

  return {
    bank,
    ...(account ? { account } : {}),
    rows,
    warnings,
    uncertain,
    source: "pdf",
    stats: { dated, recognized, chainBreaks, chainChecked, unsignedGuess },
  };
}

/** Wieder zu einer Ergebnisstruktur machen (Server): Hash und Konto neu setzen, nichts dem Client glauben. */
export function rowsToResult(input: { bank?: Bank; account?: string; rows: Omit<Buchung, "hash" | "raw" | "account">[] }): ParseResult {
  const bank = input.bank ?? "unbekannt";
  const account = input.account || bank;
  const rows: Buchung[] = input.rows.map((r) => ({ ...r, raw: {}, hash: "", account }));
  assignHashes(rows, account);
  return { bank, account, rows, warnings: [], source: "pdf" };
}
