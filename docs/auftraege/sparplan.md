# Auftrag: Sparplan im Depot

Lies docs/auftraege/gemeinsam.md, docs/profil.md, docs/depot.md, src/shared/depot.ts, src/server/depot/run.ts und die Depot-Oberfläche.

Problem: Der Depotwert rechnet mit festen Anteilen aus `investHoldings` (VUAA 12.2, XNAS 23, NVDA 3). "Einbezahlt" steigt am Stichtag (25.) automatisch um 350, der Wert aber nicht. Dadurch sinkt der Gewinn jeden Monat falsch um 350.

Vom Besitzer bestätigt:
- Sparplan: 350 CHF pro Monat, 50/50: 175 an VUAA, 175 an XNAS.
- Keine NVIDIA-Käufe mehr. Die 3 NVIDIA bleiben gehalten und werden weiter bewertet.
- Manchmal zahlt er am Monatsende zusätzlich ein (Betrag variiert). Auch diese Zusatz-Einzahlungen gehen 50/50 in VUAA und XNAS.

Bauen:
1. Einstellung `investSplit` (JSON, z.B. [{"symbol":"VUAA","pct":50},{"symbol":"XNAS","pct":50}], Summe 100, nur bekannte Symbole), mit zod geprüft, Standard wie oben. In den Depot-Einstellungen als einfache Anzeige mit Pillen änderbar, wenig Text.
2. Käufe aus Einzahlungen: Jede Einzahlung nach dem letzten Handwert (automatische Monatsrate am Stichtag und von Hand eingetragene Zusatz-Einzahlungen) wird zu gekauften Anteilen: Betrag × Anteil ÷ (Kurs EUR × EUR/CHF) am ersten Handelstag am oder nach dem Einzahlungsdatum. Tradegate liefert nur den letzten Kurs: deshalb im Tageslauf festhalten (neue Tabelle, additive Migration, z.B. depot_buys mit Einzahlungs-Schlüssel, Datum, Symbol, Anteile, Kurs, FX; eindeutig pro Einzahlung und Symbol, damit nie doppelt). Ist eine Einzahlung beim Lauf schon älter als der verfügbare Kurs, nimm den ersten verfügbaren Kurs danach und markiere das. Keine erfundenen Kurse.
3. Wertberechnung: Anteile = Positionen aus investHoldings + gekaufte Anteile bis zum Datum. Gewinn darf am Kauftag nicht springen (ausser durch Rundung).
4. Ein neuer Handwert (Besitzer trägt Wert und/oder Anteile neu ein) setzt die Basis zurück: Käufe davor zählen nicht doppelt.
5. Zusatz-Einzahlung von Hand: Prüfe, ob es in der Oberfläche schon eine schnelle Eingabe für Einzahlungen gibt. Wenn nicht: ein Tipp im Depot, Betrag gross, Datum heute.
6. Gebühren ignorieren, im Detail leise anzeigen, dass Anteile berechnet sind (z.B. "≈").
7. docs/depot.md nachführen.

Tests für alles in der reinen Logik (Monatsrate, Zusatz-Einzahlung, Wochenende, fehlender Kurs, neue Basis, kein Doppel). npm run check, npm test. Migration remote anwenden (nur additiv). Remote-DB: nichts löschen oder überschreiben. NICHT veröffentlichen. Commits als Tim Hahn <hahntim518@users.noreply.gitlab.com>. Stand in docs/auftraege/stand-sparplan.md. Schlussbericht kurz.
