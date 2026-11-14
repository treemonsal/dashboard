# Auftrag: Depot richtig rechnen, Fitbit häufiger, PDF-Kontoauszug

Dein Bereich: src/server/health/** (nur Abgleich-Häufigkeit), src/server/cron.ts, src/shared/geld.ts, src/shared/bank/**, test/bank/**, Depot-Teile in src/client/geld.tsx, src/client/import.tsx, neue Dateien für Kursabruf. Ein anderer Agent überarbeitet gleichzeitig die übrige Oberfläche (styles.css, pages-*.tsx, kalender.tsx, fitbit.tsx, cards.tsx): dort nichts ändern ausser dem, was unten ausdrücklich steht.

## 1. Depot (Fehler vom Besitzer gemeldet)
Er hat im Depot einen ersten Wert von 3175 Franken eingetragen. Dieses Geld war schon vorher drin. Die App zeigt es als Gewinn. Richtig:
- Der allererste Eintrag ist der Startbestand: Er zählt vollständig als einbezahlt, Gewinn 0. Am ersten Tag steht weder Plus noch Minus. Gewinn oder Verlust gibt es erst ab dem nächsten Wert.
- Angezeigt werden immer drei Zahlen: aktueller Wert, einbezahlt (Startbestand plus alle späteren Einzahlungen), Gewinn oder Verlust daraus, absolut und in Prozent. Auf der Geld-Seite gross der Wert, klein darunter Plus oder Minus.
- Die monatliche Einzahlung von 350 zählt ab dem Monat NACH dem Startbestand automatisch als einbezahlt (Stichtag einstellbar, Standard der 25.); einzelne Einzahlungen lassen sich von Hand nachtragen oder korrigieren.
- Tägliche Aktualisierung ohne sein Zutun: einmal pro Tag (Cron, nach Börsenschluss) den Kurs eines S&P-500-ETF holen und den Depotwert fortschreiben. Welches Produkt er hält und wie viele Anteile, ist noch nicht bekannt. Baue deshalb zwei Stufen:
  a) Sofort nutzbar: Schätzung. Der letzte von Hand eingetragene Wert wird mit der prozentualen Kursänderung eines Vergleichs-ETF seit jenem Tag fortgeschrieben, plus Einzahlungen seither. Solche Werte sind als "geschätzt" gekennzeichnet und werden vom nächsten Handwert überschrieben.
  b) Genau: In den Depot-Einstellungen lassen sich Kürzel oder ISIN, Anzahl Anteile und Währung eintragen. Dann gilt Wert = Anteile mal Kurs (mal Wechselkurs in CHF), ohne Kennzeichnung "geschätzt".
- Kursquelle: Recherchiere eine frei nutzbare Quelle ohne Schlüssel, die aus einem Cloudflare Worker erreichbar ist und Tagesschlusskurse für an der SIX oder in den USA gehandelte S&P-500-ETF sowie USD/CHF liefert (prüfe echte Antworten mit curl, nicht aus dem Gedächtnis; halte Quelle, Format und Nutzungsbedingungen in docs/depot.md fest). Baue den Abruf austauschbar und fehlertolerant: kein Kurs heisst kein neuer Wert, nie ein erfundener. Jeder Abruf schreibt sync_runs (Art "depot").
- Tests: Startbestand ohne Gewinn, Gewinn ab dem zweiten Wert, Einzahlungen, Schätzung, genaue Rechnung, fehlender Kurs, Wochenende.
- Die Remote-Datenbank enthält bereits seinen Eintrag: nichts löschen. Die neue Rechnung muss mit dem vorhandenen Eintrag das Richtige zeigen. Falls eine Migration nötig ist: additiv, remote anwenden.

## 2. Fitbit häufiger
Bisher einmal täglich ab 08:00. Neu: stündlich zwischen 06:00 und 23:00 Zürcher Zeit (nur die letzten 2 Tage), plus beim Öffnen der App, wenn der letzte Abgleich älter als 30 Minuten ist (Route dafür, vom Client beim Start aufgerufen; den Aufruf selbst darfst du in der Datei einbauen, in der die App startet, zwei Zeilen). Prüfe in der Google-Doku die Abruf-Limiten und bleib deutlich darunter. Fehlversuche nicht häufiger als alle 30 Minuten wiederholen.

## 3. Kontoauszug als PDF
Der Besitzer bekommt von seiner Bank (Revolut, Konto unter 18) nur ein PDF, und der Upload nimmt kein PDF an.
- Upload nimmt PDF an (accept und Prüfung). Text wird im Browser mit pdf.js gelesen (pdfjs-dist, erst beim ersten PDF nachgeladen, Worker-Datei selber ausliefern, keine fremden Server; Content-Security-Policy in src/server/app.ts prüfen und nur falls nötig minimal erweitern). Das PDF verlässt das Gerät nicht, nur die erkannten Buchungen gehen an den Server.
- Zeilen aus Textstücken mit Positionen wieder zusammensetzen (gleiche y-Lage gleich eine Zeile, Spalten über x-Lage).
- Parser in src/shared/bank/pdf.ts als reine Funktion über die Zeilen: erkennt Datum (auch "1. Okt. 2026", "01 Oct 2026", "01.10.2026"), Beschreibung, Betrag, Saldo; mehrzeilige Beschreibungen; Seitenköpfe und Summenzeilen überspringen; Vorzeichen aus getrennten Spalten "Ausgehend/Eingehend" bzw. "Money out/Money in" oder aus der Saldo-Differenz. Liefert dasselbe Format wie parseExport, damit Dedupe, Kategorien, Mahlzeiten und Monatsauswertung unverändert greifen.
- Es gibt noch keine echte Datei. Baue deshalb robust und ehrlich: Stimmt die Saldo-Kette nicht (Saldo vorher plus Betrag ungleich Saldo nachher) oder wurden weniger als 80 Prozent der Zeilen mit Datum als Buchung erkannt, zeigt die Vorschau eine klare Warnung mit der Zahl der unsicheren Zeilen und speichert nichts ohne Bestätigung. Zusätzlich ein Knopf "Erkannten Text kopieren" in der Vorschau, damit der Besitzer mir den Text schicken kann, falls es nicht passt.
- Tests mit erfundenen Zeilenlisten in mehreren Layouts (deutsch und englisch, mit und ohne Saldo, mehrzeilig, Seitenumbruch).

Am Ende: check, vitest, lokale Browserprüfung (PDF: erzeuge für den Test selbst ein kleines PDF mit erfundenen Buchungen), Remote-Migration falls nötig. Veröffentlichen NICHT selber (der andere Agent veröffentlicht; zwei gleichzeitige Veröffentlichungen stören sich). Schlussbericht kurz: Kursquelle mit Beleg, was gebaut und geprüft ist, was nicht, was der Besitzer eintragen muss.
