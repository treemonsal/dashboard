// Kontostand abgleichen. Beträge in Franken (wie in der Datenbank), negativ = Ausgabe. Reine Funktion.
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface SaldoAnker {
  balance: number;
  /** Tag, für den der Saldo gilt (YYYY-MM-DD) */
  day: string;
  /** "auszug": Saldo der jüngsten Auszugszeile. "eingabe": erste eingetippte Angabe (dann mit Zeitpunkt). */
  kind: "auszug" | "eingabe";
  at?: string | null;
}

export interface SaldoEingabe {
  balance: number;
  day: string;
  /** ISO-Zeitpunkt der Eingabe */
  at: string;
}

export interface SaldoBuchung {
  date: string;
  amount: number;
  /** ISO-Zeitpunkt, zu dem die Buchung angelegt wurde */
  createdAt: string;
  provisional: boolean;
}

export interface SaldoErgebnis {
  state: "kein-anker" | "keine-eingabe" | "stimmt" | "differenz";
  /** Saldo laut Rechnung: Anker plus Buchungen seither */
  expected: number | null;
  entered: number | null;
  /** eingetippt minus erwartet (negativ: es ist weniger da als gebucht) */
  diff: number;
  /** Betrag, der fehlt und in "Übrig" abgezogen wird (nie negativ) */
  unrecorded: number;
  /** Tag der Eingabe */
  day: string | null;
}

/** Zählt die Buchung nach dem Anker? Auszug: spätere Tage und alle vorläufigen. Eingabe: später als der Zeitpunkt der Eingabe. */
function afterAnchor(a: SaldoAnker, b: SaldoBuchung): boolean {
  if (a.kind === "auszug") return b.provisional || b.date > a.day;
  return b.date > a.day || (b.date === a.day && b.createdAt > (a.at ?? ""));
}

/** Zählt die Buchung noch zur Eingabe? Frühere Tage ja, am selben Tag nur, was vorher angelegt war. */
function beforeEntry(e: SaldoEingabe, b: SaldoBuchung): boolean {
  return b.date < e.day || (b.date === e.day && b.createdAt <= e.at);
}

/** Ist die Eingabe jünger als der Anker? Ein späterer Auszug macht sie überholt. */
export function entryCurrent(a: SaldoAnker | null, e: SaldoEingabe | null): boolean {
  if (!a || !e) return !!e;
  if (e.day !== a.day) return e.day > a.day;
  return a.kind === "eingabe" ? e.at > (a.at ?? "") : true;
}

export function saldoAbgleich(anchor: SaldoAnker | null, entered: SaldoEingabe | null, rows: SaldoBuchung[]): SaldoErgebnis {
  const none = { expected: null, entered: entered?.balance ?? null, diff: 0, unrecorded: 0, day: entered?.day ?? null };
  if (!anchor) return { state: "kein-anker", ...none };
  if (!entered || !entryCurrent(anchor, entered)) return { state: "keine-eingabe", ...none, entered: null, day: null };
  const sum = rows.filter((b) => afterAnchor(anchor, b) && beforeEntry(entered, b)).reduce((s, b) => s + b.amount, 0);
  const expected = r2(anchor.balance + sum);
  const diff = r2(entered.balance - expected);
  return { state: Math.abs(diff) < 0.005 ? "stimmt" : "differenz", expected, entered: entered.balance, diff, unrecorded: diff < 0 ? r2(-diff) : 0, day: entered.day };
}
