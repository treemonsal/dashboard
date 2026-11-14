# Auftrag: Kalender, Wiederholungen, Erinnerungen

Tabu (gehört dem Connector-Agenten): src/server/mcp/**. src/server/index.ts und wrangler.jsonc nur anfassen, wenn dort schon Einträge von dir stehen; sonst die nötigen Zeilen in den Schlussbericht.

1. Kalender, nur lesen, über die geheime iCal-Adresse von Google Kalender.
- Einstellungen: "Kalender-Adresse" (mehrere, je mit Name). Geheimnis: nie in Logs oder im Export, nach dem Speichern nur gekürzt anzeigen. Nur https-Adressen von calendar.google.com.
- Tabelle calendar_events. Route "Jetzt abgleichen" und `syncCalendars(env)` für den Cron.
- Eigener ICS-Leser ohne Abhängigkeit: Zeilenfaltung, DTSTART/DTEND mit TZID, UTC, reinem Datum, Europe/Zurich mit Sommerzeit, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY, UNTIL, COUNT), EXDATE, RECURRENCE-ID. Ausrollen: 14 Tage zurück, 120 voraus. Gründliche Tests mit erfundenen ICS-Texten.
- Anzeige: Termine im Tagesplan auf Heute, nach Uhrzeit mit Aufgaben gemischt, ohne Abhak-Kreis, gedämpft; Blatt mit Zeit, Ort, Beschreibung. Neuer Bereich "Woche" (über das Datum oben auf Heute): sieben Tage mit Terminen, Aufgaben, Training, Prüfungen. Titel, die mit "Hausaufgabe" beginnen, ausblenden (Schalter in den Einstellungen). "Prüfung"-Termine nicht doppelt zeigen, wenn am selben Tag eine Prüfung desselben Fachs in exams steht.
- sync_runs schreiben, "Zuletzt abgeglichen" in den Einstellungen, Fehler ehrlich melden.

2. Wiederholungen bei Aufgaben: beim Erledigen entsteht die nächste (täglich, werktags, wöchentlich an gewählten Tagen, alle n Tage, monatlich). Auswahl im Aufgaben-Blatt, Schnelleingabe erkennt "jeden Montag", "täglich", "jede Woche". Tests.

3. Erinnerungen per Web Push (iPhone, App auf dem Home-Bildschirm).
- scripts/vapid.mjs erzeugt das Schlüsselpaar mit Web Crypto, setzt den privaten Schlüssel nur über `wrangler secret put VAPID_PRIVATE_KEY`, schreibt den öffentlichen nach src/shared/push-public.ts.
- Service Worker um push und notificationclick erweitern (über vite-plugin-pwa sauber einbinden). Tabelle push_subscriptions, Routen an/ab, Schalter "Erinnerungen" in den Einstellungen (Erlaubnis erst beim Antippen, Hinweis falls nicht installiert), Route "Test-Erinnerung".
- Versand im Worker ohne Node-Bibliothek: VAPID (ES256-JWT) und aes128gcm über Web Crypto. `sendDueReminders(env)` für den Cron alle 5 Minuten: Aufgabe mit Uhrzeit 10 Minuten vorher, Training am Trainingstag um 17:00 falls offen, Prüfung am Vorabend 18:00, 21:30 "Schlafen um 22:00" falls heute noch etwas offen ist. Jede höchstens einmal (sent_reminders). Abgelaufene Abos löschen. Tests: JWT, Verschlüsselung gegen den Testvektor aus RFC 8291, Auswahl fälliger Erinnerungen.

Am Ende: Migration remote anwenden (`npx wrangler d1 migrations apply dashboard --remote`), Screenshots der neuen Ansichten nach docs/screens/ ab Nummer 50. Schlussbericht kurz: gebaut und geprüft, nicht geprüft, was in index.ts und wrangler.jsonc stehen muss, offene Punkte.
