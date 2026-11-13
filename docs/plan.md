# Bauplan: Persönliches Lebens-Dashboard für Tim

Stand 13.11.2026, Version 2. Claude (diese Sitzung) orchestriert und macht das Design selber. Opus-, Sonnet- und Haiku-Agenten bauen die Teile nach festen Verträgen (Abschnitt 7).

Gebaut wird eine private Web-App für genau einen Nutzer (Tim, KV-Lernender an der KV Zürich Business School, Einsteiger im Programmieren). Die App bündelt Aufgaben, Kalender, Finanzen, Gesundheit, Schule und Lehre an einem Ort und ersetzt Todoist.

Arbeite in Stufen. Eine Stufe ist erst fertig, wenn ihre Abnahmekriterien erfüllt und im Browser geprüft sind. Lieber fünf Bereiche, die sitzen, als fünfzehn halbe.

## 1. Entscheide, die schon gefallen sind

| Thema | Entscheid |
|---|---|
| Aufgaben | Leben nur noch im Dashboard. Todoist wird einmalig importiert und danach nicht mehr gebraucht. |
| Kalender | Bleibt bei Google Calendar. Dashboard liest und schreibt in beide Richtungen. |
| Finanzen | Tim lädt einmal pro Monat die Exporte von ZKB, Yuh und Revolut (unter 18) hoch. Kein Scraping des E-Bankings. |
| Gesundheit | Fitbit Air, Daten liegen in Google Health. Abruf per Schnittstelle, automatisch. Die Bevel-App wird nicht angebunden (keine Schnittstelle), sie liest dieselben Rohdaten. |
| Schule/Lehre | Ein Sonntagslauf öffnet einen Cloud-Browser, liest neue Noten aus dem KVZ-Portal und kommende Prüfungen aus Teams und OneNote und trägt sie über den Connector ein. Hausaufgaben werden ignoriert. Login: Microsoft-Schulkonto ohne Code. |
| Rollen | Claude orchestriert und gestaltet. Agenten bauen. |
| KI-Zugriff | Ein eigener Connector (MCP-Server), den Tim in Claude und in ChatGPT einhängt. Darüber können beide lesen und Neues anlegen. |
| Hosting | Cloudflare. Nur Tim hat Zugriff. |
| Design | Siehe Abschnitt 6. Richtung ist fix, Feinschliff ist deine Sache. |

## 1b. Nachtrag vom 13.11. (gilt vor allem anderen)

- Kein GitHub. Der Code braucht trotzdem einen sicheren Ort, sonst ist er weg, wenn die Sitzung endet. Vorschlag: privates Projekt in Tims bestehendem GitLab-Konto. Wartet auf sein Ja.
- Handy: iPhone. Push geht nur, wenn die App auf dem Home-Bildschirm installiert ist.
- Cloudflare-Konto ist verbunden, Ressourcen dürfen angelegt werden.
- Im Google Kalender liegen bereits alle Prüfungen des Semesters (von ChatGPT am 13.9. eingetragen, mit Quellenpfad). Das ist der Startbestand. Der Sonntagslauf prüft sie gegen die Quelle.
- Fächer laut Kalender: E, T+U, HKB e, W+R, FRW, M. Lehrgang BM1. Schultage Donnerstag und Freitag.
- Dritte Quelle neben Portal und Teams: Moodle (kvz-moodle2.ch).
- Die Prüfungslisten stehen in OneNote an festen Orten (zum Beispiel "Forthcoming tests", "tests term 1", "Terminplan 1. Semester", "Jahresplan"). Der Sonntagslauf liest gezielt diese Seiten statt Fliesstext zu durchsuchen. Das macht ihn deutlich zuverlässiger.
- Neu im Bereich Schule: pro Prüfung "Was drankommt" (Themen und Lernziele aus dem Klassennotizbuch), Selbsteinschätzung pro Thema (offen, unsicher, sitzt) und ein Lernplan, der rückwärts ab Prüfungsdatum rechnet, Prüfungshäufungen berücksichtigt und sich als Aufgaben übernehmen lässt. Über den Connector kann Claude Tim zu den offenen Themen abfragen.
- Bekannter Fehler im Kalender: Englisch-Prüfungen stehen auf 06:30. Der Lauf korrigiert die Zeit nach Stundenplan.
- Bestehende Hausaufgaben-Einträge im Kalender werden im Dashboard ausgeblendet, nicht gelöscht.
- Design: Abschnitt 6 ist überholt. Massgebend ist der abgenommene Entwurf (dashboard-entwurf.html): kühle Mineraltöne, Petrol als einziger Akzent, Grotesk-Schrift, grosse ruhige Zahlen, Haarlinien statt Kacheln.

## 2. Noch offen

1. Je ein echter Export von ZKB, Yuh und Revolut als Muster. Die Dateien kommen nie ins Repo.
2. iPhone oder Android (für Push und Installation als App).
3. Fächer, Lehrjahr und bisherige Noten liest der erste Sonntagslauf selber aus dem Portal. Tim muss nichts abtippen.

Grösstes Risiko, wird deshalb als Erstes getestet (Stufe 0): Bleibt Tims Anmeldung im Cloud-Browser von Sonntag zu Sonntag erhalten, und kann ein geplanter Lauf diesen Browser überhaupt starten? Wenn nein, gibt es zwei Auswege: Tim meldet sich sonntags in 30 Sekunden selber an, oder der Lauf nutzt den Browser auf Tims Computer. Das Passwort wird nie im Chat, im Code oder im Repo abgelegt.

## 3. Technik

Wähle nichts Exotisches. Vorgabe:

- Ein Cloudflare Worker, der Oberfläche und Schnittstelle zusammen ausliefert
- Oberfläche: React, Vite, TypeScript, Tailwind. Installierbar als App (PWA), Aufgaben auch offline nutzbar
- Server: Hono auf Workers, Datenbank D1 mit Drizzle, Dateien in R2, geplante Abrufe mit Cron Triggers
- Login zur Web-App: Cloudflare Access (ein Nutzer, kein selbstgebautes Login)
- Connector: Remote-MCP-Server im selben Worker unter /mcp, mit OAuth, damit Claude und ChatGPT ihn als eigenen Connector einbinden können
- Code in einem privaten GitHub-Repo, Deployment über Wrangler

Prüfe vor dem Bauen die aktuelle Dokumentation für: Remote-MCP mit OAuth auf Cloudflare, Custom Connectors in Claude und in ChatGPT, und die Google Health API (die alte Fitbit Web API wird abgelöst, verlass dich nicht auf dein Vorwissen).

Erkläre Tim jede Einrichtung, die er selber klicken muss, als nummerierte Schritte ohne Fachjargon.

## 4. Datenschutz (nicht verhandelbar)

- Finanz- und Gesundheitsdaten verlassen Cloudflare nicht. Keine Analyse-Tools, keine fremden Schriften-Server, keine Drittanbieter-Skripte
- Geheimnisse nur als Wrangler-Secrets, nie im Code oder Repo
- Jede Route prüft den Login, auch /mcp und die Cron-Endpunkte
- Der Connector bekommt getrennte Rechte: Lesen und Schreiben für Aufgaben und Kalender, nur Lesen für Finanzen und Gesundheit, Löschen nur mit Bestätigung
- Export-Knopf für alle Daten und tägliche Sicherung der Datenbank

## 5. Bereiche

### 5.1 Heute (Startseite)
Eine ruhige Seite, die den Tag beantwortet: nächste Termine, fällige Aufgaben, nächste Prüfung, Schlaf letzte Nacht, Geld übrig diesen Monat. Maximal fünf Blöcke, keine Kachelwand.

### 5.2 Aufgaben
- Projekte, Fälligkeit, Priorität, Wiederholungen, Unteraufgaben
- Schnelleingabe mit natürlicher Sprache ("Franz lernen morgen 18 Uhr")
- Tastaturbedienung, Ziehen zum Sortieren, sofortige Reaktion ohne Warten auf den Server
- Erinnerungen per Web Push
- Einmaliger Import aus Todoist über dessen Schnittstelle

### 5.3 Kalender
Google Calendar in beide Richtungen, Tages-, Wochen- und Monatsansicht. Aufgaben mit Uhrzeit erscheinen im Kalender, bleiben aber Aufgaben.

### 5.4 Finanzen
- Upload per Ziehen und Ablegen, die App erkennt selber, von welcher Bank die Datei ist. Je ein Parser für ZKB, Yuh und Revolut. Liefert eine Bank nur PDF, wird das PDF gelesen
- Doppelte Buchungen werden erkannt. Überweisungen zwischen den eigenen drei Konten zählen weder als Ausgabe noch als Einnahme
- Fremdwährungen (Revolut) werden in Franken umgerechnet
- Kategorien über Regeln, die aus Tims Korrekturen lernen (kein KI-Aufruf pro Buchung)
- Monatsübersicht, Fixkosten, Sparziele, Verlauf des Vermögens
- Am Monatsersten eine Erinnerung zum Upload

### 5.5 Schule und Lehre
Der Sonntagslauf (jeden Sonntagabend, ein Sonnet-Agent mit Cloud-Browser):

1. Öffnet das KVZ-Portal, vergleicht die Notenliste mit dem Dashboard, trägt nur Neues ein
2. Liest Teams-Kanäle und OneNote-Klassennotizbücher der letzten 7 Tage und sucht Prüfungsankündigungen. Hausaufgaben werden ignoriert
3. Schreibt über den Connector ins Dashboard und schickt Tim eine Push-Nachricht: neue Noten, neuer Schnitt, neue Prüfungen
4. Am ersten Sonntag im Monat: Erinnerung an die Bank-Exporte

Regeln für den Lauf:
- Er liest nur. Er klickt, schreibt und sendet nichts in Portal, Teams oder OneNote
- Er rät nie. Eine Note ohne klares Fach, Datum und Wert wird nicht eingetragen, sondern gemeldet
- Prüfungen aus Fliesstext sind unsicher. Sie erscheinen als "unbestätigt", bis Tim einmal tippt. Bestätigte Prüfungen werden zu Terminen mit Countdown
- Scheitert Login oder Seite, kommt eine klare Meldung statt Stille. Das Dashboard zeigt immer, wann der letzte erfolgreiche Lauf war
- Der erste Lauf liest Fächer, Lehrjahr und alle bisherigen Noten

Im Dashboard:
- Noten mit Gewichtung, Schnitt pro Fach und Rechner "welche Note brauche ich noch"
- Prüfungen mit Countdown. Bei Bestätigung schlägt das Dashboard Lernaufgaben für die Tage davor vor
- Stundenplan: Kalender-Abo, falls das Portal eines hat, sonst liest ihn der Lauf einmal pro Semester
- Mündlich angesagte Prüfungen: Schnelleingabe oder per Claude
- Lehre: Lerndokumentation, Kompetenzen, Semestergespräche, Ferien und Überzeit als einfache Listen

### 5.6 Gesundheit
- Nächtlicher Abruf aus Google Health: Schlaf, Schritte, Ruhepuls, Training, Gewicht falls vorhanden
- Trends über 7, 30, 90 Tage. Keine medizinischen Aussagen, keine erfundenen Scores

### 5.7 Connector für Claude und ChatGPT
Werkzeuge: Aufgaben suchen, anlegen, ändern, abhaken. Termine lesen und anlegen. Noten und Prüfungen lesen und anlegen. Finanzen und Gesundheit als Zusammenfassung lesen. Jede Werkzeugbeschreibung kurz und eindeutig. Liefere Tim die Klickanleitung für beide Apps.

### Später, nicht jetzt
Gewohnheiten, Ziele, Notizen, Lesezeichen. Erst wenn Stufe 5 abgenommen ist.

## 6. Design

Ziel: wirkt wie ein Produkt eines kleinen, teuren Studios. Ruhig, präzise, typografisch.

Farben (hell, dunkel folgt dem System):

| Rolle | Hell | Dunkel |
|---|---|---|
| Fläche | #F6F4EF | #0F0F0D |
| Text | #16150F | #ECE9E1 |
| Sekundär | #6F6B60 | #9A968A |
| Haarlinie | #E3DFD5 | #26251F |
| Akzent | #1F4D3A | #7FB79A |
| Negativ | #8A2B1E | #D98A7A |

Der Akzent kommt sparsam vor: aktiver Zustand, eine Linie im Diagramm, ein Knopf pro Ansicht. Prüfe alle Kontraste und passe Werte leicht an, aber wechsle die Richtung nicht.

Schrift: Newsreader für grosse Zahlen und Titel, Geist für die Oberfläche, Tabellenziffern überall, wo Zahlen untereinander stehen. Schriften selber ausliefern.

Aufbau: viel Weissraum, Haarlinien statt Kästen, klares Raster, eine Spalte auf dem Handy. Diagramme schlicht: eine Linie, direkte Beschriftung, kein Gitter-Dschungel.

Verboten, weil es nach KI aussieht: Farbverläufe, Violett, Glaseffekte, Schatten-Kacheln mit grossen Rundungen, Emojis, Icons vor jeder Überschrift, Begrüssungen wie "Guten Morgen, Tim", bunte Statistik-Kacheln, Ladekreisel.

Bewegung: kurz und physisch. 150 bis 250 ms, Federkurven, Übergänge zwischen Ansichten, Platzhalter statt Kreisel, jede Eingabe wirkt sofort. Reduzierte Bewegung respektieren. Ziel 60 Bilder pro Sekunde auf dem Handy.

Nutze vorhandene Hilfen, falls in deiner Sitzung verfügbar: die Skills apple-design und dataviz, Mobbin für Referenzen echter Apps (Finanz-, Kalender-, Aufgaben-Apps). Baue zuerst die Design-Grundlage (Farben, Schrift, Abstände, 8 bis 10 Bausteine) und zeig Tim einen Screenshot der Startseite, bevor du weitere Seiten baust.

## 7. Subagents und Tokens

Claude selber: Design-Grundlage, alle Bildschirme als Entwurf, Schnittstellen-Verträge, Abnahme jeder Stufe mit Screenshots.

Abgeben, sobald der Vertrag (Typen, Tabellen, Routen) steht:

| Aufgabe | Modell |
|---|---|
| Architektur, Datenmodell, Connector mit OAuth, Offline-Abgleich der Aufgaben | Opus 5.5 |
| Google Calendar, Google Health, Todoist-Import, Bildschirme nach Entwurf umsetzen, Sonntagslauf | Sonnet 5.5 |
| Bank-Parser, Testdaten, Tests, Formulare nach vorhandenen Bausteinen, Suche in Dokumentation | Haiku 5.5 |

Regeln: unabhängige Aufgaben parallel starten. Jeder Subagent bekommt Vertrag, Dateipfade und Abnahmekriterium, sonst nichts. Kein Subagent entwirft Oberfläche frei. Gib nichts ab, was du in wenigen Minuten selber schreibst, der Start eines Subagents kostet auch Tokens.

## 8. Stufen und Abnahme

| Stufe | Inhalt | Fertig, wenn |
|---|---|---|
| 0 | Test des Cloud-Browsers mit KVZ-Login. Repo, Worker, Datenbank, Login, Design-Grundlage | Klar, ob der Sonntagslauf ohne Tim läuft. Leere App ist online, nur Tim kommt rein, Screenshot abgenommen |
| 1 | Heute, Aufgaben, Kalender, Todoist-Import | Tim nutzt eine Woche kein Todoist mehr |
| 2 | Connector | Claude und ChatGPT legen je eine Aufgabe und einen Termin an |
| 3 | Schule und Lehre, Sonntagslauf | Zwei Sonntage in Folge ohne Eingriff, Noten stimmen mit dem Portal überein |
| 4 | Finanzen | Exporte aller drei Banken fehlerfrei eingelesen, zweiter Upload erzeugt keine Doppel, eigene Überweisungen neutral |
| 5 | Gesundheit | Drei Nächte in Folge automatisch aktualisiert |
| 6 | Feinschliff | Handy und Desktop geprüft, keine Ruckler, Tastatur überall |

Vor jeder Abnahme: Tests grün, im echten Browser auf Handy- und Desktop-Breite durchgeklickt, Screenshots an Tim. Sag ehrlich, was nicht geht oder noch von Hand läuft.

## 9. Was Tim einmalig selber tun muss

Cloudflare-Konto, Google-Freigabe für Kalender und Health, Todoist-Token für den Import, Connector in Claude und ChatGPT einhängen, App auf dem Handy installieren, einmal im Cloud-Browser beim Schulkonto anmelden, monatlich die drei Bank-Exporte hochladen, unbestätigte Prüfungen antippen.
