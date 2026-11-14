# Depot

## Rechnung (src/shared/depot.ts)
- Der erste von Hand eingetragene Wert ist der Startbestand: zählt voll als einbezahlt, Gewinn 0.
- Einbezahlt = Startbestand + monatliche Einzahlung (Standard 350) am Stichtag (Standard 25., einstellbar 1 bis 28) in jedem Monat NACH dem Startmonat + von Hand nachgetragene Einzahlungen, die nach dem Startbestand liegen.
- Gewinn eines Werts = Wert minus Einzahlungen bis zu dessen Datum (nicht bis heute), in Franken und Prozent.
- Die Einstellung `investStart` wird nicht mehr gerechnet (der Startbestand ist der erste Wert).

## Tägliche Fortschreibung (src/server/depot, Cron)
Einmal pro Zürcher Tag ab 23:00 (US-Börsenschluss 22:00), nach einem Fehler nach 55 Minuten erneut; von Hand über POST /api/depot/refresh ("Jetzt abrufen"). Jeder Lauf schreibt sync_runs mit Art "depot".
- Schätzung (ohne Kürzel/Anteile): letzter Handwert mal Kursänderung von SPY (in CHF, mit USD/CHF) seit dem Handwert plus Einzahlungen seither. Zeilen sind `estimated = 1` und erscheinen als "geschätzt". SPY ist ein ausschüttender ETF, der Kurs ohne Dividenden: gegenüber einem thesaurierenden Produkt unterschätzt die Schätzung etwa 1,3 Prozent pro Jahr. Der nächste Handwert setzt neu an.
- Genau (Kürzel, Anteile, Währung in den Depot-Einstellungen): Wert = Anteile mal Schlusskurs (mal USD/CHF), Zeilen mit Notiz "auto", nicht geschätzt. Die Anteile müssen nach jedem Kauf nachgeführt werden.
- Kein Kurs (Quelle nicht erreichbar, Wochenende, Feiertag) = kein neuer Wert, nie ein erfundener. Ein Handwert wird nie verändert; nur Zeilen des Laufs vom selben Tag werden ersetzt.

## Kursquellen (src/server/depot/kurse.ts, austauschbar)
Geprüft am 14.11.2026 mit curl aus der Sitzung:
- Aktienkurse: Cboe, verzögerte Tageskurse der öffentlichen Webseite, ohne Schlüssel.
  `GET https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/SPY.json`
  Antwort `{ "symbol", "timestamp", "data": [{ "date": "2026-11-12", "open", "high", "low", "close": 757.12, "volume" }, ...] }`, 5756 Tage, älteste zuerst (rund 600 KB). Funktioniert für US-Kürzel (SPY, IVV, VOO geprüft); CSPX und SPLG gaben 403. Nicht an der SIX gehandelte Produkte gibt es dort nicht.
  Nutzungsbedingungen: Es gibt keine dokumentierte Schnittstelle und keine Zusicherung; Cboe stellt die Daten für die Webseite bereit. Ich fand keine ausdrückliche Erlaubnis oder ein Verbot für Abrufe durch Programme; ein Abruf pro Tag ist weit unter dem, was eine Webseite erzeugt. Kann jederzeit wegfallen: dann kommt kein neuer Wert und der Lauf steht als Fehler in sync_runs.
- Wechselkurs: Frankfurter (Referenzkurse der EZB), ohne Schlüssel, ausdrücklich frei.
  `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=CHF&from=2026-09-01` Antwort `[{ "date", "base", "quote", "rate": 0.83399 }, ...]`.
- Nicht brauchbar: Yahoo Finance (429 aus der Sitzung, inoffiziell, Bedingungen verbieten Automaten), Stooq (Verbindung zurückgesetzt), Alpha Vantage und Twelve Data (Schlüssel nötig).
- Kein Kurs für SIX-Produkte (z.B. CSSPX in CHF) ohne Schlüssel gefunden. Hält der Besitzer ein solches, bleibt es bei der Schätzung mit SPY.
