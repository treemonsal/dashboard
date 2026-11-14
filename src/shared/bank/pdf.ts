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
        const w = it.w ?? it.text.length * 4.5;
        const last = cells.at(-1);
        if (last && it.x - last.x2 <= gap) {
          last.text += (it.x - last.x2 > 0.8 || !/\s$/.test(last.text) ? " " : "") + it.text.trim();
          last.x2 = Math.max(last.x2, it.x + w);
        } else cells.push({ x: it.x, x2: it.x + w, text: it.text.trim() });
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

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, janvier: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, mär: 3, maer: 3, mrz: 3, märz: 3, maerz: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dezember: 12, dec: 12, december: 12,
};
const MON = "[A-Za-zÄäÖöÜü]{3,9}";
const pad2 = (n: number) => String(n).padStart(2, "0");
function valid(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const iso = (y: number, m: number, d: number) => (valid(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null);

/** Datum am Anfang eines Textes: 01.10.2026, 1. Okt. 2026, 01 Oct 2026, Oct 1, 2026, 2026-10-01. Liefert Datum und Länge. */
export function matchDate(s: string): { date: string; len: number } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
  if (m) {
    const d = iso(+m[1]!, +m[2]!, +m[3]!);
    return d ? { date: d, len: m[0].length } : null;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(s);
  if (m) {
    const d = iso(+m[3]!, +m[2]!, +m[1]!);
    return d ? { date: d, len: m[0].length } : null;
  }
  m = new RegExp(`^(\\d{1,2})\\.?\\s+(${MON})\\.?,?\\s+(\\d{4})(?!\\d)`).exec(s);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    const d = mo ? iso(+m[3]!, mo, +m[1]!) : null;
    return d ? { date: d, len: m[0].length } : null;
  }
  m = new RegExp(`^(${MON})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`).exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const d = mo ? iso(+m[3]!, mo, +m[2]!) : null;
    return d ? { date: d, len: m[0].length } : null;
  }
  return null;
}

/* ---------- Spalten ---------- */

type Col = "date" | "desc" | "out" | "in" | "amount" | "balance";
interface Anchor {
  col: Col;
  x: number;
  x2: number;
}
const HEADER_WORDS: [Col, RegExp][] = [
  ["date", /^(datum|date|buchungsdatum|valuta)$/],
  ["desc", /^(beschreibung|description|text|buchungstext|details|verwendungszweck)$/],
  ["out", /^(ausgehend|money out|belastung|ausgaben|soll|paid out|debit|abbuchung|ausgang)$/],
  ["in", /^(eingehend|money in|gutschrift|einnahmen|haben|paid in|credit|eingang)$/],
  ["amount", /^(betrag|amount)$/],
  ["balance", /^(saldo|balance|kontostand)$/],
];

/** Kopfzeile mit Spaltenüberschriften: mindestens zwei verschiedene, darunter eine Betrags- oder Saldospalte. */
export function findHeader(line: PdfLine): Anchor[] | null {
  const found: Anchor[] = [];
  const c = line.cells;
  for (let i = 0; i < c.length; i++) {
    for (const span of [2, 1]) {
      if (i + span > c.length) continue;
      const slice = c.slice(i, i + span);
      const t = slice.map((x) => x.text).join(" ").toLowerCase().replace(/[:.]/g, "").trim();
      const hit = HEADER_WORDS.find(([, re]) => re.test(t));
      if (hit) {
        found.push({ col: hit[0], x: slice[0]!.x, x2: slice.at(-1)!.x2 });
        i += span - 1;
        break;
      }
    }
  }
  const kinds = new Set(found.map((f) => f.col));
  if (kinds.size < 2 || !(kinds.has("out") || kinds.has("in") || kinds.has("amount") || kinds.has("balance"))) return null;
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

/** Eine Zelle als Betrag lesen. Verlangt zwei Nachkommastellen, damit Nummern und Hausnummern nie als Betrag gelten. */
function asNumber(cell: PdfCell): Num | null {
  const t = cell.text.trim();
  const cur = CUR.exec(t)?.[1]?.toUpperCase();
  const bare = t.replace(/\b(CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD)\b/gi, "").replace(/[€$£]/g, "").trim();
  if (!/\d[.,]\d{2}\s*-?\)?$/.test(bare)) return null;
  if (!/^[-+−(]?\s*\d[\d'’ .,]*\d\s*-?\)?$/.test(bare)) return null;
  const v = parseAmount(bare);
  if (v === null) return null;
  return { rappen: v, cur, cell, signed: /^[-+−(]|-\s*$|\)$/.test(bare) };
}

/* ---------- Seitenköpfe, Summen ---------- */

const JUNK =
  /^(seite|page)\s+\d+(\s+(von|of|\/)\s+\d+)?$|^(kontoauszug|account statement|statement|auszug|kontoübersicht|account summary|transaktionen|transactions)\b|\b(iban|bic|swift)\b|^(total|summe|gesamt|gesamtsumme|zwischensumme|übertrag|uebertrag|subtotal|carried forward|brought forward)\b|^(anfangssaldo|endsaldo|schlusssaldo|saldo (zu beginn|am ende|vortrag)|opening balance|closing balance|starting balance|ending balance|balance (at|on) )|revolut (bank|ltd)|generiert|generated|erstellt am|^www\.|^(zeitraum|period)\b/i;
const OPENING = /^(anfangssaldo|saldo (zu beginn|vortrag)|opening balance|starting balance|saldo per beginn)/i;

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

function detectBank(text: string): Bank {
  if (/revolut/i.test(text)) return "revolut";
  if (/(?<![a-z0-9])zkb(?![a-z0-9])|z(ü|ue|u)rcher kantonalbank/i.test(text)) return "zkb";
  if (/(?<![a-z0-9])yuh(?![a-z0-9])|swissquote/i.test(text)) return "yuh";
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
  return best && bd <= 60 ? best.col : null;
}

export function parsePdf(lines: PdfLine[], options: ParseOptions = {}): PdfParse {
  const warnings: string[] = [];
  const head = lines.slice(0, 40).map((l) => l.text).join("\n");
  const bank = detectBank(head);
  const iban = detectIban(head);
  const account = options.account ?? iban ?? bank;

  const raws: Raw[] = [];
  let anchors: Anchor[] = [];
  let opening: number | undefined;
  let cur: Raw | null = null;
  let dated = 0;
  let page = -1;
  let pageHasRow = false;

  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      pageHasRow = false;
      cur = null; // Beschreibungen laufen nicht über Seitenumbrüche (Kopf und Fuss stehen dazwischen)
    }
    const hdr = findHeader(line);
    if (hdr) {
      anchors = hdr;
      cur = null;
      continue;
    }
    const text = line.text;
    const dm = matchDate(text);
    if (!dm) {
      if (OPENING.test(text)) {
        const nums = line.cells.map(asNumber).filter((x): x is Num => !!x);
        if (nums.length) opening = nums.at(-1)!.rappen;
        cur = null;
        continue;
      }
      if (JUNK.test(text.trim())) {
        cur = null;
        continue;
      }
      // Fortsetzung der Beschreibung: nur Text, keine Zahlen in den Betragsspalten
      if (cur && pageHasRow) {
        const extra = line.cells.filter((c) => !asNumber(c) || (anchors.length && columnOf(asNumber(c)!, anchors) === null)).map((c) => c.text).join(" ").trim();
        if (extra) cur.desc = `${cur.desc} ${extra}`.trim();
      }
      continue;
    }
    // Zeile beginnt mit Datum
    dated++;
    // Zellen nach dem Datum
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
    // Zahlen von rechts einsammeln (höchstens 3)
    const nums: Num[] = [];
    while (rest.length && nums.length < 3) {
      const n = asNumber(rest.at(-1)!);
      if (!n) break;
      nums.unshift(n);
      rest.pop();
    }
    const desc = rest.map((c) => c.text).join(" ").trim();
    if (!nums.length) {
      cur = null;
      continue;
    }
    let balance: number | undefined;
    let amountNum: Num | undefined;
    let sign: -1 | 0 | 1 = 0;
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
        // Lage passt zu keiner Spalte: Reihenfolge Betrag, Saldo
        const rest2 = nums.filter((n) => n !== bal?.n);
        if (rest2.length === 1) amountNum = rest2[0];
        if (amountNum?.signed) sign = amountNum.rappen < 0 ? -1 : 1;
      }
    } else {
      if (nums.length >= 2) {
        balance = nums.at(-1)!.rappen;
        amountNum = nums.at(-2)!;
      } else amountNum = nums[0];
      if (amountNum?.signed) sign = amountNum.rappen < 0 ? -1 : 1;
    }
    if (!amountNum) {
      cur = null;
      continue;
    }
    cur = { date: dm.date, desc, abs: Math.abs(amountNum.rappen), sign, balance, cur: amountNum.cur ?? nums.find((n) => n.cur)?.cur, text };
    raws.push(cur);
    pageHasRow = true;
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

  // Vorzeichen und Kette
  let unsignedGuess = 0;
  let chainBreaks = 0;
  let chainChecked = 0;
  let prev: number | undefined = opening;
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
      description: r.desc,
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
