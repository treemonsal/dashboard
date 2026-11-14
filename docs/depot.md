# Depot

## Rechnung (src/shared/depot.ts)
- Der erste von Hand eingetragene Wert ist der Startbestand: zählt voll als einbezahlt, Gewinn 0.
- Einbezahlt = Startbestand + monatliche Einzahlung (Standard 350) am Stichtag (Standard 25., einstellbar 1 bis 28) in jedem Monat NACH dem Startmonat + von Hand nachgetragene Einzahlungen, die nach dem Startbestand liegen.
- Gewinn eines Werts = Wert minus Einzahlungen bis zu dessen Datum (nicht bis heute), in Franken und Prozent.
- Die Einstellung `investStart` wird nicht mehr gerechnet (der Startbestand ist der erste Wert).

## Portfolio ab 14.11.2026
Die Oberfläche heisst Portfolio. Bestätigte Positionen sind VUAA 12.2 Anteile, XNAS 23 Anteile und NVIDIA 3 Aktien. Ohne bisherige Konfiguration verwendet das Dashboard diese bestätigten Mengen. Eine gespeicherte Einzelposition bleibt erhalten, bis die drei Positionen ausdrücklich übernommen werden. `investHoldings` speichert mehrere Positionen als JSON; `[]` deaktiviert sie und erhält die bisherige SPY Schätzung. Einträge von Hand bleiben erhalten.

| Position | ISIN | Einordnung | Bewertungsquelle |
|---|---|---|---|
| VUAA | IE00BFMXXD54 | Vanguard S&P 500 UCITS ETF, thesaurierend | Tradegate EUR |
| XNAS | IE00BMFKG444 | Xtrackers Nasdaq 100 UCITS ETF 1C | Tradegate EUR |
| NVIDIA | US67066G1040 | Einzelaktie | Tradegate EUR |

Bewertet wird dieselbe Anteilsklasse an Tradegate in EUR, unabhängig vom Kaufplatz. Die Fondswährung USD ist nicht automatisch die Handelswährung. [Vanguard Factsheet](https://fund-docs.vanguard.com/SandP_500_UCITS_ETF_USD_Accumulating_9694_INT_OFF_ETF_EN.pdf) bestätigt VUAA in London USD und an Xetra und in Mailand EUR. Das [DWS Factsheet](https://etf.dws.com/de-de/AssetDownload/Index/f9aaa547-b389-4116-9a1b-c48618a805ad/Factsheet.pdf) bestätigt XNAS in London USD, Xetra und Mailand EUR sowie SIX und BX CHF. XNAS bildet den Nasdaq 100 ab und wird nie über den S&P 500 geschätzt.

## Tägliche Fortschreibung
Ab 23:00 Uhr Europe/Zurich, bei Fehler nach 55 Minuten erneut. Manuell über POST /api/depot/refresh. Jeder Lauf schreibt ein Ergebnis in sync_runs.

Tradegate liefert nur einen aktuellen letzten Kurs, keine Zeitreihe. Erst nach Ende der Handelssitzung wird dessen Handelstag verwendet. Das Dashboard rekonstruiert keine erfundene Historie. Neue Gesamtwerte entstehen nur nach dem letzten Handwert, wenn alle Positionen einen tatsächlichen Kurs desselben Tages und einen EUR/CHF Referenzkurs besitzen. Berechnung: Summe aus Anteilen mal EUR Kurs mal EUR/CHF. Fehlt eine Position, entsteht weder ein Teilwert noch eine SPY Schätzung. Tage vor dem ersten Abruf können mit dieser Quelle nicht nachgetragen werden. Aktuelle Anteile gelten ab dem letzten Handwert; nach Käufen oder Verkäufen Mengen aktualisieren und einen neuen Handwert setzen.

## Tatsächlich geprüfte Quellen
Am 14.11.2026 direkt über HTTPS geprüft:

| Quelle | Kursdatum | letzter Kurs EUR |
|---|---|---|
| [Tradegate VUAA](https://www.tradegatebsx.com/orderbuch.php?isin=IE00BFMXXD54) | 13.11.2026, 22:00 | 132.915 |
| [Tradegate XNAS](https://www.tradegatebsx.com/orderbuch.php?isin=IE00BMFKG444) | 13.11.2026, 22:00 | 58.86 |
| [Tradegate NVIDIA](https://www.tradegatebsx.com/orderbuch.php?isin=US67066G1040) | 13.11.2026, 22:00 | 147.60 |

VUAA war damit der teurere der beiden ETF. Die Zuordnung 12.2 VUAA und 23 XNAS stammt aus dieser Preisrelation und Tims bestätigten Mengen. Die Kurse werden zur Laufzeit geladen und nicht fest als Depotwerte gespeichert.

Die öffentliche Tradegate HTML Seite ist keine zugesicherte API. Der Parser prüft ISIN, EUR Kennzeichnung, Datum und positiven Kurs. Änderungen, Sperren oder Ausfälle führen zu keinem neuen Wert. Kein Zugriff auf Konten oder Broker nötig.

Frankfurter liefert EUR/CHF und USD/CHF als Referenzkurse der EZB, ohne Schlüssel: `https://api.frankfurter.dev/v2/rates?base=EUR&quotes=CHF&from=YYYY-MM-DD`. Referenzkurs und letzter Tradegate Kurs sind keine ausführbaren Brokerkurse und kein Echtzeitkurs.

Bestehende US Einzelpositionen nutzen weiter Cboe: `https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/VOO.json`. Cboe konnte VUAA nicht liefern (403). Stooq ergab 404, FT 403 und Yahoo 429. Diese Quellen dienen nicht als Ersatz für fehlende europäische Kurse.

Nur ausdrücklich leere Positionslisten erhalten die frühere SPY Schätzung aus letztem Handwert, SPY Kursänderung in CHF und Einzahlungen. Sie ist als geschätzt markiert. Automatische Werte verändern nie Einträge von Hand.
