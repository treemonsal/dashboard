# Auftrag: Alles antippbar, Schritt für Schritt bis zum Ende

Wunsch des Besitzers, sinngemäss: "Alles soll tippbar sein und immer einen Schritt weitergehen, bis es ein wirklich komplettes Ende hat. Gefühlt unendlich hinein in die Daten." Die Hauptseiten bleiben ruhig. Die Tiefe liegt dahinter.

Lies docs/profil.md und die bestehende Oberfläche (src/client). Abgenommenes Aussehen nicht ändern: nur dunkel, Leiste unten mit Symbolen (tritt bei offenem Blatt zurück), Scrollen in #scroller, Auswahl als Pillen, Eingabefeld für Aufgaben oben, keine Textauswahl, keine Leertexte bei Aufgaben. Echte Daten des Besitzers liegen in der Remote-Datenbank (13 Noten, 30 Tage Fitbit, 62 Trainings, 77 Buchungen, Stundenplan, 6 Prüfungen): nur lesen.

## Grundmuster
- Jede Zahl, jeder Balken, jeder Punkt, jede Zeile ist antippbar, solange dahinter mehr steckt. Was kein "dahinter" hat, sieht nicht antippbar aus.
- Tiefe läuft über Unterseiten mit dem runden Zurück-Knopf oben (nicht Blatt über Blatt über Blatt). Ein Blatt nur für das letzte Detail oder für Eingaben. Zurück führt immer genau eine Stufe zurück; der Tipp auf das aktive Symbol in der Leiste führt zur Hauptseite.
- Jede Stufe zeigt oben in einer Zeile, wo man ist (z.B. "November · Woche 2 · Sonstiges"), als antippbare Teile.
- Die Adresse bildet die Stufe ab (z.B. /geld/analyse/2026-11/w2/sonstiges), damit Zurück, Neuladen und der Tipp auf die Leiste stimmen.
- Übergänge kurz und ruhig (bestehende Bewegungen nutzen), reduzierte Bewegung beachten.

## Geld
Analyse (Monat) -> Woche antippen (Balken) -> Ausgaben nur dieser Woche nach Kategorie -> Kategorie antippen -> Buchungen dieser Kategorie in dieser Woche -> Buchung antippen -> Buchungsdetail (Händler, Betrag, Datum und Uhrzeit falls vorhanden, Konto, Kategorie änderbar, Mahlzeit ja/nein, eigene Überweisung, Originaltext, "gleicher Händler": alle Buchungen bei diesem Händler mit Summe und Anzahl, antippbar). Dasselbe von der Monatsübersicht aus: Kategorie -> Buchungen -> Detail. Auf der Geld-Seite sind "Ausgegeben", jedes Konto, das Depot (Positionen einzeln, je mit Wert, Anteilen, Kurs, Verlauf) und "Offen von Mama" jeweils der Einstieg in eine eigene Kette. Tag im Verlauf antippen -> Buchungen dieses Tages.

## Körper
Schlaf -> Übersicht mit Schnitt (7/30/90) -> Woche antippen -> die sieben Nächte dieser Woche mit Schnitt -> Nacht antippen -> diese Nacht (Dauer, Einschlaf- und Aufwachzeit und Phasen, falls die Daten da sind; prüfe, was health_daily und die Google-Health-Anbindung hergeben, und erweitere den Abgleich nur, wenn die Schnittstelle es liefert). Gleich für Schritte (Tag -> Stunden, falls vorhanden, sonst Tageswert mit Vergleich zum Schnitt), Ruhepuls, Gewicht. Trainings -> Woche -> Training -> Detail (Dauer, Puls, Kalorien, gleiche Art im Vergleich).

## Ziele und Schule
Notenschnitt -> Fach -> einzelne Note -> Detail (Wert, Gewicht, Datum, wie sie den Fachschnitt verschoben hat, was die nächste Note sein muss). Prüfung -> Themen -> Thema -> Themenseite mit Einschätzung, zugehörigen Lernaufgaben, Notizfeld und einem Feld "Zusammenfassung" (leer, bis etwas eingetragen ist; es wird später über den Connector gefüllt: füge dafür im Connector das Werkzeug `set_topic_summary` hinzu, Recht school, Text höchstens 4000 Zeichen, und nimm die Zusammenfassung in `list_exams` auf). Gym-Raster -> Woche -> Tag -> Training -> Übung -> Verlauf der Übung über alle Trainings. Zeit: Jahr -> Monat -> Tag -> was an diesem Tag war (Termine, Aufgaben, Training, Schlaf, Ausgaben).

## Aufgaben und Heute
Aufgabe -> verknüpfte Prüfung -> Thema -> Themenseite. Lernaufgaben, die aus einer Prüfung entstanden sind, zeigen Prüfung und Thema als antippbare Zeile. Termin -> Detail -> gleicher Tag. Lektion -> Fach -> Noten des Fachs. Tagesring -> Liste -> Eintrag -> Detail. Jahrespunkte -> Zeit -> Tag.

## Technik
- Wo Auswertungen fehlen, neue schlanke API-Routen (zod, hinter der Anmeldung) oder im Client aus vorhandenen Daten rechnen; reine Rechenfunktionen nach src/shared mit Tests (Wochen eines Monats, Summen pro Kategorie und Woche, Händler-Schlüssel, Schnitt pro Woche).
- Nicht anfassen (gehört einem anderen Agenten): src/shared/bank/**, src/client/pdf*.ts, src/client/import.tsx, src/server/depot/**, src/shared/depot.ts, src/server/bankimport.ts, pdfRows in src/shared/schemas.ts.
- Prüfen: check, npm test, und im Browser mit einem lokalen Abzug der Remote-Datenbank (Abzug und Screenshots ausserhalb des Repos unter /tmp/claude-0/-home-user/3c8c0941-71cb-55d9-a1d6-26cd5cf31e86/scratchpad/echt2/, Abzug am Ende löschen). Jede Kette einmal ganz hinein und ganz zurück klicken; 393x852, dunkel; keine Konsolenfehler; nichts unter der Leiste; lange Namen brechen sauber um.
- NICHT veröffentlichen. Lege 10 Screenshots der tiefsten Stufen nach scratchpad/echt2/final-*.png.
- Reihenfolge, falls die Zeit nicht reicht: Geld ganz, dann Körper, dann Schule, dann der Rest. Lieber drei Ketten vollständig als sechs halbe.
