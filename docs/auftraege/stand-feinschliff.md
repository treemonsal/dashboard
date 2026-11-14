# Stand Feinschliff
- Fertig: Durchsicht Teil 1 (Tokens statt Einzelwerte, Seitentitel, Zahlenformat, Gym-Raster verpasst/Wackeltag, Woche verpasst, Restzeit-Balken Heute).
- Als Nächstes: Verbundene Apps, Abgleich, Lernvorschläge (shared + Tests), weitere Durchsicht, Screenshots, check/vitest, Deployment.

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
