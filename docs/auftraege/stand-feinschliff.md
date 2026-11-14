# Stand Feinschliff
- Fertig: Durchsicht Teil 1, Gym-Raster/Woche (verpasst, Wackeltag), Restzeit-Balken, Verbundene Apps (Blatt mit Bestätigung, Leerzustand mit Adresse), Abgleich-Läufe, Lernvorschläge (src/shared/vorschlag.ts, 8 Tests, Anzeige als gedämpfte Uhrzeit mit Tipp). check und vitest grün (368).
- Deployt (zweimal, 302/401 ok). Screenshots neu (49, scripts/pruefen.cjs und scripts/screens-neu.cjs).
- Als Nächstes: nichts offen ausser den Punkten unten.

## Gefunden / behoben
- Pfeil-Symbol in Einstellungen riesig (kein Grössenstil in .row): behoben.
- Aufgabenliste: senkrechte Linie der Zeitleiste lief durch die Texte (Klasse nl fehlte): behoben. Einzelne Einträge in der Woche hatten Linienstummel: behoben.
- Reiter in Aufgaben: Zahl brach unter die Beschriftung, Reiter ungleich hoch: behoben.
- Seitentitel mit Einzelwerten (28px, Farbe) an vier Stellen: eine Klasse, Wert aus tokens.css.
- Schriftgrössen in styles.css als Einzelwerte: alle auf Tokens umgestellt; Geldbeträge nehmen Tokens.
- Verläufe: Glow-Hintergrund auf Geld und Körper, Flächenverlauf im Ausgabendiagramm: entfernt.
- Doppelte/erklärende Texte: Erinnerungen (Titel und Zeile gleich), Noten-Untertitel, "Als Nächstes:" unter dem Ring, iCal-Erklärsatz: gekürzt.
- Tausender: schmaler, nicht umbrechender Abstand (U+202F).
- Tote Platzhalter (versteckte span-Elemente zum Verstecken ungenutzter Importe): entfernt.
- Eingabeleiste in Aufgaben sass nach rechts verschoben (Animation überschrieb transform): behoben.
- Chips in Karten unsichtbar (gleiche Farbe wie Karte): Kartenfarbe 2.
- Kategorie-Symbole in Geld hatten fünf Farben ohne Bedeutung: neutral. Diagramm-Verlauf entfernt, Lebensraster liest Tokens statt Hex.
- pruefen.cjs: Zeile scrollt vor dem Wischtest in die Mitte.
- Vorschläge nie in der Vergangenheit.

## Gesehen, nicht behoben
- Migration 0005 (Fitbit) ist remote nicht angewendet (Berechtigung verweigert); Fitbit-Karte meldet bis dahin einen Fehler.
- Vorschläge nur in Heute und Woche, nicht in der Aufgabenliste.
- Kalender-Termine fehlen in den Screenshots (keine Kalender-Adresse lokal).
