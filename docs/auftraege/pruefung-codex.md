# Prüfung Codex-Arbeit vom 14.11. (selbst geprüft, 15.11.)

## Gut
- Aufgaben-Wiederholung: Update, Ereignis und Folgeaufgabe in einem D1-Batch, durch mutation_id abgesichert. Kein Doppel bei Doppeltipp (eindeutiger predecessor_id). Rücknahme löscht nur die eigene, unberührte Folgeaufgabe.
- Migration 0009 rein additiv, keine Daten verloren.
- Rückzahlungen: Hand-Vorgabe (repayment_override) bleibt beim Neuberechnen.
- Fitbit-Sync: Cursor sync_through, höchstens 30 Tage pro Lauf, Teilfehler verschieben nichts.
- Export: Kalenderadressen (enthalten Schlüssel), Fitbit-Tokens und Zugangsdaten bleiben draussen.
- Tradegate-Abruf echt geprüft: Format passt (ISIN, "Kurse in EUR", id="last", id="rt_datum"). Intraday-Werte werden verworfen, Lauf ab 23:00.
- Bewertung plausibel: 12.2 VUAA, 23 XNAS, 3 NVDA zu Kursen 13.11. = 3418 EUR = 3167 CHF, eingetragen 3175. Kein Scheingewinn am Start.
- Neue Routen alle hinter Access, Eingaben mit zod geprüft, Connector gibt keine Einzelbuchungen heraus.

## Behoben
- Notenquelle zeigte "connector", neu "Schulportal".

## Offen (Bedenken)
- Depot rechnet mit festen Anteilen. Monatliche Käufe (350 CHF) erhöhen den Wert erst, wenn die Anteile nachgeführt werden. Lösung: am Kauftag Einzahlung automatisch buchen und Anteile nach Aufteilung des Sparplans zum Tageskurs dazurechnen. Braucht vom Besitzer die Aufteilung.
- Tradegate ist eine HTML-Seite, keine API. Ändert sich das Layout, kommt "kein vollständiger Kurs" (sicher, aber still). Fehler wird in sync_runs festgehalten.
- Export enthält sync_runs-Texte; aktuell ohne Geheimnisse, bei neuen Läufen darauf achten.
