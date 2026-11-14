# Fitbit und Google Health

Stand 14.11.2026. Zuerst die Entscheidung mit Quellen, dann die Anleitung für dich (Tim), dann was geprüft ist und was nicht.

## 1. Entscheidung: Google Health API (v4)

Die alte Fitbit Web API (dev.fitbit.com) ist abgeschaltet oder wird gerade abgeschaltet. Fitbit-Daten liefert nur noch die Google Health API. Darauf ist der Client gebaut.

- Die Fitbit-Seite nennt: Support endete am 30.9.2026, abgeschaltet am 30.10.2026. Die Google-Seite nennt 2.11.2026. Die Daten sind widersprüchlich, aber beide Daten liegen vor heute (14.11.2026). Ein Weg über die alte Schnittstelle fällt also weg.
- Die Google Health API ist seit 24.3.2026 da, der Kanal `v4` ist stabil. Basisadresse `https://health.googleapis.com/v4/`.
- Bestehende Fitbit-Freigaben werden nicht übernommen. Es braucht eine neue Zustimmung, das macht die App beim Verbinden.
- Anmeldung: Google OAuth 2.0 (Authorization Code mit PKCE), Rechte nur lesen: `googlehealth.activity_and_fitness.readonly` (Schritte, Training), `googlehealth.health_metrics_and_measurements.readonly` (Ruhepuls, Gewicht), `googlehealth.sleep.readonly` (Schlaf).
- Kosten: keine. Es braucht ein Google-Cloud-Projekt, aber keine Rechnungsadresse und keine Kreditkarte für diese API (nirgends in der Dokumentation verlangt; selber nicht ausprobiert).
- Datentypen und Felder habe ich aus dem Discovery-Dokument der Schnittstelle (`https://health.googleapis.com/$discovery/rest?version=v4`, Revision 20261113), nicht aus dem Gedächtnis: `steps` (Tagessumme per `dailyRollUp`), `daily-resting-heart-rate`, `weight`, `sleep`, `exercise`.
- Tokens: Zugriffstoken gelten etwa eine Stunde. Der Refresh-Token läuft im Status "Testing" nach 7 Tagen ab, im Status "Veröffentlicht" (In Produktion) normalerweise nicht, ausser er wird 6 Monate nicht benutzt oder du widerrufst den Zugriff. Darum unten: App veröffentlichen.
- Neu angelegte Clients sind "nicht verifiziert" mit höchstens 100 Nutzern. Für dich allein reicht das, du siehst beim Anmelden eine Warnung "Google hat diese App nicht überprüft".
- Der Anbieter ist austauschbar: `src/server/health/types.ts` definiert die Schnittstelle (`HealthProvider`), `google.ts` ist die einzige Umsetzung. Ein zweiter Anbieter (z.B. später Apple Health über eine Datei) müsste nur diese Funktionen liefern.

Quellen
- Google Health API, Übersicht und Fristen: https://developers.google.com/health
- Release Notes (Start 24.3.2026, v4 stabil, Rechte nur lesen oder schreiben): https://developers.google.com/health/release-notes
- Einrichtung Cloud-Projekt und OAuth: https://developers.google.com/health/setup
- Wechsel von der Fitbit Web API (Rechte, Datentypen): https://developers.google.com/health/migration/api-specifications
- Rechte-Liste: https://developers.google.com/health/scopes
- Schnittstellenbeschreibung (maschinenlesbar): https://health.googleapis.com/$discovery/rest?version=v4
- Abschaltung der alten API: https://dev.fitbit.com/build/reference/web-api/
- Wann ein Refresh-Token ungültig wird: https://developers.google.com/identity/protocols/oauth2

## 2. Was gebaut ist

- Tabellen (Migration `0005_gesundheit`): `health_connection` (Tokens, verschlüsselt), `health_oauth_state` (laufende Anmeldung), `health_workouts` (Trainings). Schlaf, Schritte, Ruhepuls, Gewicht gehen in die bestehende `health_daily` (Quelle `fitbit`).
- Tokens: AES-256-GCM, Schlüssel aus dem Secret `HEALTH_TOKEN_KEY`. Client-ID und Secret in der App eingetragen (verschlüsselt in D1) oder als Worker-Secrets. Nichts davon in Code, Antworten, Logs oder `sync_runs`.
- Routen (alle hinter Cloudflare Access): `GET /api/fitbit/status`, `POST /api/fitbit/connect`, `GET /api/fitbit/callback`, `POST /api/fitbit/sync`, `DELETE /api/fitbit/connection`, `GET /api/fitbit/workouts`.
- Abgleich `syncHealth(env)`: beim ersten Verbinden die letzten 30 Tage, danach die letzten 3 Tage (so kommen spät übertragene Werte nach). Der Cron (alle 5 Minuten) startet ihn einmal pro Zürcher Tag ab 08:00, nicht nachts: der Schlaf endet erst, wenn du aufwachst, und das Fitbit überträgt erst dann. Nach einem Fehler versucht er es nach etwa einer Stunde wieder. Dazu der Knopf "Jetzt abgleichen".
- Zuordnung: Schlaf zählt zum Tag des Aufwachens (Europe/Zurich), Minuten Schlaf ohne Wachphasen, Nickerchen zählen nicht, mehrteilige Nächte werden addiert. Gewicht: letzte Wägung des Tages. Training: Tag des Beginns, Dauer, Kalorien, mittlerer Puls. Fehlt ein Wert in der Antwort, bleibt ein vorhandener (auch von Hand eingetragener) stehen.
- Fehler werden ehrlich gemeldet: je Messgrösse ("Gewicht: Keine Berechtigung …"), abgelaufener Zugang als "Neu verbinden", alles in `sync_runs` (Art `fitbit`).
- Oberfläche: Einstellungen, Abschnitt "Fitbit" (verbinden, Status, abgleichen, trennen) und der Leerzustand im Körper-Tab.
- Trainings: Liste der letzten im Körper-Tab, Blatt mit Details. Sie zählen nicht automatisch als Gym; das Trainingsblatt des Tages zeigt nur den Hinweis "Fitbit hat Krafttraining erkannt".
- Zugangsdaten: Tabelle `health_credentials` (Migration 0006), AES-256-GCM mit `HEALTH_TOKEN_KEY`; `credentials.ts` löst sie auf (App vor Worker-Secrets).

## 3. Einrichtung (in der App, etwa 20 Minuten)

Du brauchst nur die App: Körper-Tab, "Einrichten" (oder Einstellungen, Fitbit, "Einrichten"). Das Blatt führt durch sieben Schritte, je mit "Öffnen" (direkter Link in die Google Cloud Console) und, wo nötig, "Kopieren". Abgehakte Schritte bleiben gespeichert. Kein Terminal, keine Secrets.

1. Projekt "Dashboard" anlegen (console.cloud.google.com/projectcreate).
2. "Google Health API" aktivieren (console.developers.google.com/apis/library/health.googleapis.com).
3. Zielgruppe "Extern", deine E-Mail als Testnutzer, "App veröffentlichen" (sonst läuft die Verbindung nach 7 Tagen ab).
4. Bereiche: die drei Leserechte einfügen (Kopier-Knopf im Blatt).
5. OAuth-Client "Webanwendung" mit der Weiterleitungs-URI `https://dashboard.hahntim518.workers.dev/api/fitbit/callback` (Kopier-Knopf).
6. Client-ID und Client-Secret im Blatt einfügen, "Speichern". Sie liegen verschlüsselt in der Datenbank und werden nie wieder angezeigt (nur die letzten 4 Zeichen der ID). Löschen ist im Blatt möglich. Worker-Secrets (`GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET`) gelten weiter als Rückfall.
7. "Fitbit verbinden", Konto wählen, bei "Google hat diese App nicht überprüft" auf "Erweitert" und "Weiter zu Dashboard", alle drei Rechte angehakt lassen.

Falls Google wegen des Alters kein Projekt zulässt: Ein Elternteil macht die Schritte 1 bis 5 im eigenen Google-Konto und trägt deine E-Mail als Testnutzer ein.

Danach läuft es von selbst, jeden Morgen nach 08:00. Die Knopfnamen stammen aus der Google-Doku (developers.google.com/health/setup) und stehen deutsch mit dem englischen Namen in Klammern, weil die deutsche Console nicht geprüft werden konnte.

Wenn es nicht klappt: Der Abschnitt "Fitbit" in den Einstellungen zeigt die Meldung. Häufig: "Neu verbinden" (Zugang abgelaufen: nochmals verbinden), "Keine Berechtigung" (ein Recht abgewählt oder API nicht aktiviert), "redirect_uri_mismatch" bei Google (Adresse in Schritt 5 stimmt nicht).

## 4. Was geprüft ist und was nicht

Geprüft (nachgestellte Antworten, 38 Tests in `test/health`): Feldzuordnung, Zürcher Tage (Winter- und Sommerzeit), Schlaf zum Aufwachtag, Nickerchen, mehrere Seiten, Token-Erneuerung (abgelaufen, 401 mitten im Abgleich, neuer Refresh-Token, widerrufen), Fehlerfälle (403, 429, 500, Netz, fehlende Secrets), `state` einmalig und mit Ablauf, PKCE-Challenge (Testvektor aus RFC 7636) und Verifier beim Tausch, Verschlüsselung, Trennen, kein Token in Datenbank im Klartext, Antworten, Logs und `sync_runs`. Der Worker läuft lokal mit der neuen Migration, Oberfläche im Browser (393x852, dunkel) in drei Zuständen angesehen.

Nicht geprüft, weil Zugangsdaten fehlen:
- Der echte Durchlauf gegen Google (Anmeldung, Tausch, echte Antworten). Die Antworten sind nach dem Discovery-Dokument nachgebaut. Abweichungen im Detail (z.B. genaue Filtersyntax, ob `daily-resting-heart-rate` wirklich unter `health_metrics_and_measurements` liegt) zeigen sich erst beim ersten echten Abgleich, als Meldung pro Messgrösse.
- Ob Google die App ohne Verifizierung auf "In Produktion" stellen lässt und ob die Refresh-Tokens dann wirklich lange halten.
- Ob ein Konto unter 18 die Freigabe erteilen darf (Familien- und Jugendkonten haben bei Google manchmal Einschränkungen).
- Die Rückkehr von Google nach `/api/fitbit/callback` hinter Cloudflare Access (die Cookie-Sitzung sollte bei einer normalen Weiterleitung mitgehen, ungeprüft).
- Die Datenbank-Migration auf der echten Datenbank (siehe Schritt 8).

## 5. Risiken
- Die Schnittstelle ist neu (seit März 2026) und die Rechtenamen wurden im Mai 2026 geändert; Google ändert sie eventuell wieder.
- Schlaf: ein Schlaf, den das Fitbit erst nach 08:00 überträgt, kommt am nächsten Tag (der Abgleich holt immer die letzten 3 Tage).
- Das Secret `HEALTH_TOKEN_KEY` darf sich nie ändern.
