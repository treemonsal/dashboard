// Gemeinsame Typen des Bank-Imports. Reine Logik, kein I/O.

export type Bank = "revolut" | "zkb" | "yuh" | "unbekannt";

/** Eine Buchung. Beträge in Rappen (Ganzzahl), negativ = Ausgabe. */
export interface Buchung {
  /** Datum der Transaktion, YYYY-MM-DD */
  date: string;
  /** Zeitpunkt der Verbuchung (YYYY-MM-DD oder YYYY-MM-DDTHH:MM[:SS]) */
  bookedAt?: string;
  description: string;
  amount: number;
  currency: string;
  /** Betrag in CHF-Rappen (bei Fremdwährung per Kurs, sonst gleich amount) */
  amountChf: number;
  balance?: number;
  counterparty?: string;
  raw: Record<string, string>;
  hash: string;
  /** Konto-Kennung (IBAN aus der Datei, sonst Bankname) */
  account?: string;
  /** true, wenn amountChf mangels Kurs nur geschätzt (1:1) ist */
  chfEstimated?: boolean;
  category?: string;
  /** Manuelle Übersteuerung: Mahlzeit (true) oder Snack (false) */
  isMeal?: boolean;
  /** Eigene Überweisung zwischen zwei eigenen Konten */
  internal?: boolean;
}

export interface ParseOptions {
  /** Überschreibt die erkannte Konto-Kennung */
  account?: string;
  /** CHF pro 1 Einheit Fremdwährung, z.B. { EUR: 0.95 } */
  rates?: Record<string, number>;
  /** Nur für parseWithMapping: Dateiname als Hinweis für die Bank-Erkennung */
  fileName?: string;
}

export interface ColumnMapping {
  /** Spaltenindizes (0-basiert) in der Kopfzeile */
  date?: number;
  valuta?: number;
  description?: number | number[];
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  currency?: number;
  amountChf?: number;
  counterparty?: number;
  /** Index der Kopfzeile in der Datei (nach Vorspannzeilen) */
  headerRow?: number;
  delimiter?: string;
  /** Währung, wenn es keine Währungsspalte gibt (Standard CHF) */
  defaultCurrency?: string;
}

export interface ParseResult {
  bank: Bank;
  account?: string;
  rows: Buchung[];
  warnings: string[];
  /** true: Spalten nicht sicher erkannt, rows ist leer, die UI soll suggestedMapping bestätigen lassen */
  needsConfirmation?: boolean;
  suggestedMapping?: ColumnMapping;
  header?: string[];
  /** PDF: Zahl unsicherer Zeilen; grösser als 0 heisst: nur nach Bestätigung speichern */
  uncertain?: number;
  source?: "pdf";
}
