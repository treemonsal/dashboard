# Auftrag: Live-Stand ins Repo zurückholen, dann Codex-Arbeit prüfen

## Lage
Ein anderes Werkzeug (Codex) hat am 14.11. abends am Projekt gearbeitet (Commit "Fix data integrity and PDF imports; add three-position portfolio", Notiz in docs/2026-11-14-fixes.md) und danach noch zweimal veröffentlicht, ohne die letzten Änderungen ins Repo zu legen. Die Live-Version ist also neuer als das Repo. Würden wir jetzt veröffentlichen, ginge diese Arbeit verloren (der PDF-Import des Besitzers funktioniert erst seit dieser Version: 77 echte Buchungen sind importiert).

Die Live-Dateien liegen ausserhalb des Repos unter /tmp/claude-0/-home-user/3c8c0941-71cb-55d9-a1d6-26cd5cf31e86/scratchpad/live/:
- worker-index.js: der veröffentlichte Worker (ungekürzt, lesbar)
- pdf-chunk.min.js: der veröffentlichte Client-Baustein für PDF (minifiziert, 15 KB; lokal gebaut sind es nur 10 KB)
- index-chunk.min.js: der veröffentlichte Haupt-Baustein (bis auf den Dateinamen des PDF-Bausteins identisch mit dem lokalen Build)

Bekannte Unterschiede im Worker (diff gegen dist/dashboard/index.js nach `npx vite build`): drei Grenzen im Schema pdfRows (account 100 statt 40, description 1000 statt 400, name 500 statt 200) und die Zahlenerkennung in src/shared/bank/num.ts (Tausenderpunkte und -kommas). Im Client-Baustein steckt deutlich mehr Parser-Code (src/shared/bank/pdf.ts und/oder src/client/pdf.ts).

## Teil 1: Rekonstruktion (zuerst, das blockiert jede Veröffentlichung)
1. Übertrage die Unterschiede in den Quelltext, bis der lokale Build dem Live-Stand entspricht. Messlatte: Nach `npx vite build` ist dist/dashboard/index.js zeichengleich mit worker-index.js, und der gebaute PDF-Baustein ist zeichengleich mit pdf-chunk.min.js (abgesehen vom eingebetteten Dateinamen des Haupt-Bausteins). Minifizierte Namen sind deterministisch: Wenn dein Quelltext dasselbe tut und gleich aufgebaut ist, kommt derselbe Code heraus. Arbeite dich über einen strukturierten Vergleich heran (formatiere beide minifizierten Dateien gleich und vergleiche funktionsweise).
2. Ist Zeichengleichheit beim Client-Baustein nicht erreichbar, dann wenigstens gleiches Verhalten: jede Regel, jedes Synonym, jede Regex und jede Schwelle aus der Live-Datei muss im Quelltext stehen. Liste im Bericht genau auf, was nicht zeichengleich ist und warum.
3. Schreibe Tests für das neu Übertragene (erfundene Zeilen, keine echten Kontodaten). `npm run check` und `npm test` grün.
4. NICHT veröffentlichen. Das mache ich, nachdem ich die Gleichheit selber geprüft habe.

## Teil 2: Prüfung der Codex-Arbeit (danach)
Lies den Unterschied des Commits (git show --stat HEAD~1 zeigt die Übernahme; die Änderungen betreffen u.a. src/server/depot/**, src/shared/depot.ts, src/server/bankimport.ts, src/server/health/sync.ts, migrations/0009_integrity.sql, src/client/query-state.tsx, Wiederholungen bei Aufgaben). Prüfe gezielt:
- Richtigkeit: Depot mit drei Positionen (VUAA, XNAS, NVIDIA; Kurse von Tradegate in EUR, Umrechnung in CHF): Startbestand ohne Gewinn, keine Teilwerte bei fehlendem Kurs, Wochenenden, Rundung. Rufe die Kursquelle einmal echt mit curl ab und prüfe, dass der Abruf zum Format passt.
- Datenintegrität: Migration 0009 und die Logik für Wiederholungen und Rückzahlungen.
- Sicherheit: neue Routen hinter der Anmeldung, Eingaben validiert, nichts Geheimes im Export oder in Logs, der Connector gibt weiterhin keine Einzelbuchungen heraus.
- Abweichungen von docs/profil.md (Oberfläche: nur dunkel, wenig Text, Pillen, Schweizer Schreibweise).
Behebe eindeutige Fehler mit Test. Grössere Bedenken nur auflisten. Schreibe das Ergebnis nach docs/auftraege/pruefung-codex.md: was gut ist, was falsch war und behoben ist, was offen bleibt.

Dein Bereich: src/shared/bank/**, src/client/pdf*.ts, src/client/import.tsx, src/shared/schemas.ts (nur pdfRows), src/server/depot/**, src/shared/depot.ts, src/server/bankimport.ts, Tests. Ein anderer Agent baut gleichzeitig Vertiefungs-Ansichten in der Oberfläche (pages-*.tsx, geld.tsx ausser Import, sheets*.tsx, neue Dateien): diese Dateien nicht anfassen.
