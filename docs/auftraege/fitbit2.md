# Auftrag: Fitbit einrichten ohne Fachwissen

Der Besitzer (15, Einsteiger) fand die bisherige Anleitung in docs/fitbit.md zu kompliziert. Ziel: Er richtet Fitbit ein, ohne je ein Terminal, einen Chat oder Fachbegriffe zu brauchen. Lies docs/fitbit.md, src/server/health/**, src/client/fitbit.tsx. Die Migration 0005 ist remote angewendet, das Secret HEALTH_TOKEN_KEY ist gesetzt.

1. Zugangsdaten in der App statt als Worker-Secrets. Client-ID und Client-Secret werden in den Einstellungen der App eingetragen (hinter Cloudflare Access), mit HEALTH_TOKEN_KEY verschlüsselt in D1 gespeichert (z.B. Tabelle settings oder die bestehende Verbindungstabelle; falls neue Spalte nötig: Migration, auch remote anwenden mit `npx wrangler d1 migrations apply dashboard --remote`; wird das abgelehnt, melden) und nie wieder im Klartext ausgegeben (nur "eingetragen" und die letzten 4 Zeichen der ID). Worker-Secrets bleiben als Rückfall gültig. Eine Hilfsfunktion löst die wirksamen Zugangsdaten auf; routes.ts, sync.ts, google.ts benutzen sie. Löschen der Zugangsdaten möglich. Tests ergänzen (kein Klartext in DB, Antworten, Logs).
2. Geführte Einrichtung in der App, als Blatt mit nummerierten Schritten, je Schritt EIN Satz, ein Knopf "Öffnen" mit direktem Link in die Google Cloud Console und wo nötig ein Wert zum Kopieren (Kopier-Knopf):
   - Projekt anlegen: https://console.cloud.google.com/projectcreate (Name "Dashboard")
   - Google Health API einschalten (direkter Link zur API-Seite in der Bibliothek; ermittle den richtigen Link aus der offiziellen Doku developers.google.com/health/setup, nicht raten)
   - Zustimmungsbildschirm: Zielgruppe Extern, eigene E-Mail als Testnutzer, dann "App veröffentlichen" (Produktion), damit die Verbindung nicht nach 7 Tagen abläuft
   - Bereiche (Scopes): die drei readonly-Bereiche zum Kopieren
   - OAuth-Client "Webanwendung" mit der Weiterleitungs-URI zum Kopieren: https://dashboard.hahntim518.workers.dev/api/fitbit/callback
   - Client-ID und Client-Secret in zwei Felder im selben Blatt einfügen, speichern
   - "Fitbit verbinden"
   Prüfe die Schritte und Knopfnamen gegen die aktuelle offizielle Google-Doku (Web), und schreib bei jedem Schritt die Knopfnamen so, wie sie in der deutschen Console heissen, mit dem englischen Namen in Klammern, wo du unsicher bist. Hinweis im Blatt: Falls Google wegen des Alters kein Projekt zulässt, muss ein Elternteil die Schritte 1 bis 5 im eigenen Google-Konto machen und Tims E-Mail als Testnutzer eintragen.
   Der Fortschritt (welcher Schritt abgehakt ist) bleibt gespeichert.
3. docs/fitbit.md Abschnitt 3 durch dieselben Schritte ersetzen, kurz.
4. Trainings aus health_workouts im Körper-Tab anzeigen (Liste der letzten, Blatt mit Details) und im Tagesplan bzw. Gym-Raster NICHT automatisch als Gym zählen (Gym trägt er selber ein), aber im Trainingsblatt des Tages als Hinweis zeigen, wenn Fitbit an dem Tag ein Krafttraining erkannt hat.
5. Rückkehr von Google: Stelle sicher, dass /api/fitbit/callback hinter Access funktioniert (Cookie SameSite, Weiterleitung als Top-Level-Navigation). Wenn das nur mit einer Access-Ausnahme ginge: nicht ändern, melden.
Am Ende: check, vitest, Screenshots der neuen Blätter nach docs/screens (Nummern ab 60), und veröffentlichen mit `npm run deploy` (erlaubt, wenn alles grün und der Arbeitsbaum sauber ist). Danach prüfen: `/` liefert 302, POST `/mcp` 401.
