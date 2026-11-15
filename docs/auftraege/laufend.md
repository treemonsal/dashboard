# Auftrag: Buchungen im laufenden Monat

Problem des Besitzers: Kontoauszüge (PDF) gibt es erst am Monatsende für den Vormonat. Im laufenden Monat ist der Geld-Bereich deshalb leer, "Übrig" stimmt nicht. Lies docs/profil.md, src/shared/bank/README.md, src/server/bankimport.ts, src/shared/geld.ts, die Geld-Seiten im Client (inklusive der neuen Vertiefungs-Seiten unter /geld/...). Abgenommenes Aussehen und die Vertiefungs-Ketten nicht verändern, nur ergänzen.

## 1. Vorläufige Buchungen
- Buchungen bekommen einen Zustand: bestätigt (aus Auszug) oder vorläufig, und eine Herkunft (auszug, kurzbefehl, hand). Additive Migration. Bestehende 77 Buchungen sind bestätigt.
- Vorläufige zählen in "Übrig", Monatssumme, Kategorien, Mahlzeiten-Regel genau wie bestätigte, sind in Listen aber leise gekennzeichnet (z.B. hohler Punkt), ohne Text.
- Abgleich beim Import eines Auszugs: Jede vorläufige Buchung desselben Kontos im Zeitraum des Auszugs wird einer Auszugszeile zugeordnet (gleicher Betrag, Datum höchstens 3 Tage auseinander, bei mehreren Kandidaten der ähnlichste Händlername, jede Zeile nur einmal). Treffer: die Auszugszeile gewinnt, übernimmt aber Kategorie und Mahlzeit-Wahl der vorläufigen, die vorläufige verschwindet. Ohne Treffer im abgedeckten Zeitraum: bleibt als "nicht im Auszug" sichtbar, mit einem Tipp zum Löschen oder Behalten. Reine Funktion in src/shared/bank mit gründlichen Tests (Doppel, gleiche Beträge am selben Tag, Trinkgeld-Abweichung gilt NICHT als Treffer, Fremdwährung).

## 2. Eingang per Kurzbefehl (Hauptweg)
iOS kann in der Kurzbefehle-App eine Automation "Transaktion" auslösen, wenn mit einer Karte aus Wallet bezahlt wird, und dabei Händler, Betrag und Kartenname weitergeben.
- Neue Route `POST /eingang/buchung` ausserhalb der Cloudflare-Access-Anmeldung (ich gebe den Pfad danach in Access frei). Sie darf sich NICHT auf Access verlassen: Zugang nur mit einem eigenen Schlüssel im Header `Authorization: Bearer <schlüssel>`.
- Schlüssel: in den Einstellungen erzeugen (32 zufällige Bytes, base64url), wird genau einmal angezeigt (Kopier-Knopf), in der Datenbank nur als SHA-256-Hash, Vergleich zeitkonstant, jederzeit widerrufbar und neu erzeugbar. Ohne Schlüssel ist die Route aus (404).
- Die Route kann ausschliesslich vorläufige Buchungen anlegen: nichts lesen, nichts ändern, nichts löschen. Antwort ohne Daten (nur ok). Eingaben streng prüfen (zod): Händler höchstens 120 Zeichen, Betrag als Zahl oder als Text wie "CHF 12.50", "12,50 CHF", "Fr. 12.50" (reine Funktion zum Erkennen mit Tests), Betrag höchstens 5000, Währung, optional Karte/Konto (Zuordnung über einen in den Einstellungen wählbaren Namen, Standard Revolut), optional Zeitpunkt. Doppel-Schutz: gleicher Händler, Betrag und Konto innerhalb von 2 Minuten zählt einmal. Rate-Limit 60 pro Tag und 10 pro Minute. Falscher Schlüssel: 401 ohne Hinweis; nach 20 Fehlversuchen pro Stunde gesperrt für diese Stunde. Jeder Eingang schreibt sync_runs (Art "kurzbefehl") ohne Betrag oder Händler im Text.
- Kategorie und Mahlzeit über die vorhandenen Regeln.
- Geführte Einrichtung in der App (Blatt wie bei Fitbit, nummerierte Schritte, je ein Satz, Werte zum Kopieren): Kurzbefehle öffnen, Automation, "Transaktion", Karte wählen, "Sofort ausführen", Aktion "Inhalte von URL abrufen" mit Adresse, Methode POST, Header Authorization, JSON-Feldern merchant, amount, card. Prüfe die genauen deutschen Bezeichnungen in der aktuellen Apple-Doku (Web); wo du unsicher bist, schreib den englischen Namen in Klammern. Dazu "Test senden" (aus der App, über die normale angemeldete Route) und die Anzeige "letzter Eingang vor x".
- Hinweis im Blatt in einem Satz: funktioniert nur für Zahlungen mit Apple Pay; Twint, Überweisungen und Online-Zahlungen kommen erst mit dem Auszug oder von Hand.

## 3. Von Hand
- Schnelle Eingabe auf der Geld-Seite (runder Knopf mit Plus neben den vorhandenen Symbolen, ohne Beschriftung): Betrag (Zifferneingabe gross), Händler (Vorschläge aus bisherigen Händlern), Kategorie (vorgeschlagen), Konto, Datum heute. Zwei Tipps für den häufigsten Fall. Legt eine vorläufige Buchung an. Eingabefeld oben im Bild halten (iPhone verschiebt sonst die Seite; siehe wie .qtop bei Aufgaben gelöst ist).
- Vorläufige Buchungen lassen sich im Buchungsdetail ändern und löschen (bestätigte nicht löschen).

## 4. Kontostand abgleichen
- Pro Konto lässt sich der aktuelle Kontostand eintippen (im Konto-Detail). Die App rechnet: letzter bekannter Saldo aus dem Auszug, plus und minus alle Buchungen seither, verglichen mit dem eingetippten Stand. Differenz als "nicht erfasst" anzeigen und in "Übrig" als eigene Zeile abziehen, bis Buchungen sie erklären. Ein Tipp macht aus der Differenz eine vorläufige Sammelbuchung "Nicht erfasst". Reine Funktion mit Tests.

## 5. Connector
- `money_summary` nennt neu den Anteil vorläufiger Buchungen und den nicht erfassten Betrag. Kein neues Schreibwerkzeug.

Am Ende: check, npm test, Browserprüfung mit lokalem Abzug der Echtdaten (ausserhalb des Repos, am Ende löschen), ein echter Aufruf der Eingangsroute lokal mit curl (richtiger und falscher Schlüssel, Doppel, Limit). Migration remote anwenden. NICHT veröffentlichen und keine Access-Regel ändern: das mache ich. Schlussbericht kurz: gebaut und geprüft, nicht geprüft, exakter Pfad für die Access-Freigabe, Sicherheitsüberlegungen.
