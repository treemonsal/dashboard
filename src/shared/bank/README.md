# Bank-Import (reine Logik)

Alles hier ist rein (kein I/O, keine Abhängigkeiten) und läuft im Worker wie im Browser.
Import: `import { parseExport, ... } from "../shared/bank"`. Beträge sind Rappen (Ganzzahl), negativ = Ausgabe.

## Ablauf beim Upload (API)

```ts
// 1. Datei lesen
let res = parseExport(text, file.name, { rates: { EUR: 0.95 } });   // rates optional, CHF pro Fremdwährungseinheit
if (res.needsConfirmation) {
  // Spalten unsicher: rows ist leer. UI zeigt res.header + res.suggestedMapping, Tim bestätigt/ändert,
  // dann: res = parseWithMapping(text, mapping, { fileName: file.name });
}
// res.warnings immer anzeigen (fehlender Kurs, übersprungene Zeilen, unbekannte Bank)

// 2. Doppel ausfiltern (existingHashes = alle Hashes aus der DB)
const { fresh } = dedupe(existingHashes, res.rows);

// 3. Kategorien: eigene (gelernte) Regeln vor den Standardregeln
const rules = [...userRulesFromDb, ...DEFAULT_RULES];
const categorized = applyCategories(fresh, rules);
```

Speichern: `categorized` mit `hash` (UNIQUE) und `account`. Danach, auf **allen** Buchungen aus der DB (nicht nur den
neuen), weil Paare und Rückzahlungen über Uploads hinweg entstehen:

```ts
const all = markInternalTransfers(allRowsFromDb);            // setzt internal = true auf beiden Seiten
const meals = mealShares(all, { payerName, minMealRappen: 1000 });
//   meals.openRappen, meals.openMeals, meals.settled, meals.unmatchedIncoming, meals.repaymentRows
const sum = monthSummary(all, "2026-11", 30000, { payerName });   // 30000 = 300 Franken Budget
```

`internal` darf beim Lesen neu berechnet werden; von Hand korrigierte Werte (`category`, `isMeal`) müssen gespeichert bleiben.

## Korrektur durch Tim

```ts
const rule = learnRule(row.description, "Lebensmittel");   // null, wenn kein Händler erkennbar
// in die Regel-Tabelle speichern, beim nächsten Upload vorn in `rules` einreihen
```

## Funktionen

| Funktion | Zweck |
|---|---|
| `parseExport(text, fileName?, opts?)` | Bank erkennen, CSV lesen, Buchungen mit `hash` und `account` |
| `guessColumns(header)` / `parseWithMapping(text, mapping, opts?)` | Spalten raten bzw. mit bestätigter Zuordnung lesen |
| `dedupe(existingHashes, rows)` | `{ fresh, duplicates }` |
| `categorize(row, rules)` / `applyCategories(rows, rules)` | Erster Regeltreffer gewinnt, sonst "Sonstiges" |
| `learnRule(description, category)` | Neue Regel aus Korrektur |
| `markInternalTransfers(rows)` | Paare über Konten (gleicher Betrag, umgekehrtes Vorzeichen, höchstens 3 Tage) |
| `mealShares(rows, settings)` | Mahlzeiten, 50 % Anteil der Mutter, Zuordnung der Twint-Eingänge |
| `monthSummary(rows, "YYYY-MM", budget, opts?)` | Ausgaben (eigener Anteil), Kategorien, Tagesverlauf, Hochrechnung |

## Festlegungen

- **Datum**: Revolut verwendet das Startdatum als `date`, das Abschlussdatum (mit Uhrzeit) als `bookedAt`. Bei anderen Banken ist `date` die Datumsspalte, `bookedAt` die Valuta.
- **Konto**: IBAN aus den Vorspannzeilen, sonst der Bankname (`revolut`, `zkb`, `yuh`, `unbekannt`). Mehrere Konten derselben Bank ohne IBAN in der Datei: `opts.account` übergeben, sonst kollidieren die Hashes.
- **Hash**: Konto, Datum, Betrag, Währung, Text, laufende Nummer gleicher Buchungen am selben Tag (in Dateireihenfolge). Ändert eine Bank die Schreibweise des Textes, entstehen neue Hashes.
- **Fremdwährung**: ohne Kurs ist `amountChf` gleich dem Originalbetrag, `chfEstimated: true` und eine Warnung.
- **Mahlzeit**: Kategorie "Gastronomie" und mindestens 10 Franken; das Feld `isMeal` auf der Buchung (oder in der Regel) übersteuert. Eingänge, deren Text den `payerName` enthält, gelten nie als Einkommen und gehen an die älteste offene Mahlzeit (bis 3 Tage Vorlauf).
- **monthSummary**: Hochrechnung linear aus dem Tagesschnitt bis "heute" (`opts.today`, sonst jüngste Buchung); abgeschlossene Monate werden nicht hochgerechnet. "Sparen/Anlage" und interne Überweisungen zählen nicht als Ausgabe.

## PDF-Kontoauszug (pdf.ts)

Im Browser liest pdf.js die Textstücke mit Position; `groupLines(items)` macht Zeilen (gleiche y-Lage) und Zellen (Lücke in x), `parsePdf(lines)` liefert ein `ParseResult` wie `parseExport` (gleiche `Buchung`, Hash, Konto), dazu `uncertain`, `warnings` und `stats`.
- Datum: `01.10.2026`, `1. Okt. 2026`, `01 Oct 2026`, `Oct 1, 2026`, ISO. Beträge brauchen zwei Nachkommastellen, sonst sind es Referenznummern.
- Vorzeichen aus den Spalten Ausgehend/Eingehend (Money out/in, Belastung/Gutschrift), sonst aus dem eigenen Vorzeichen, sonst aus der Saldo-Differenz. Neueste zuerst wird an der Saldo-Kette erkannt und gedreht.
- `uncertain > 0` bei falscher Saldo-Kette, weniger als 80 Prozent erkannter Datumszeilen oder unsicherem Vorzeichen: Warnung, und der Server speichert nur mit `confirmed` (POST /api/import/commit mit `pdf`).
- `pdfText(lines)` gibt den erkannten Text mit x-Lagen zum Kopieren aus. `rowsToResult` setzt auf dem Server Hash und Konto neu.
- Nur mit erfundenen Zeilen und selbst erzeugten PDFs geprüft; ein echtes Revolut-PDF fehlt noch.
