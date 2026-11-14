# Connector für Claude und ChatGPT

Adresse des Connectors: **https://dashboard.hahntim518.workers.dev/mcp**

## Entscheidung

Der Worker ist selber OAuth-2.1-Server (`@cloudflare/workers-oauth-provider` 1.2.4, Zustand nur im KV-Namespace `dashboard-oauth`, Tokens und Codes nur als Hash) und spricht MCP über Streamable HTTP mit dem offiziellen SDK (`@modelcontextprotocol/server`, `createMcpHandler`), zustandslos pro Anfrage, also ohne Durable Objects und ohne Migration. Claude und ChatGPT verlangen beide genau diesen Weg: Protected Resource Metadata mit 401 und `resource_metadata`, PKCE mit S256, Client-Registrierung per DCR oder Client ID Metadata Document (beides ist eingeschaltet; Claude nimmt CIMD, wenn `none` angeboten wird, ChatGPT bevorzugt CIMD), `iss` in der Antwort (RFC 9207, nötig für die feste ChatGPT-Adresse) und rotierende Refresh-Tokens. Ein fremder Login-Dienst oder eine eigene Token-Logik wäre mehr Code und mehr Angriffsfläche; die Zustimmung bleibt hinter Cloudflare Access, weil es nur einen Besitzer gibt.

## Was wie geschützt ist

| Pfad | Access | Geschützt durch |
|---|---|---|
| `/mcp` (auch `/mcp/…`) | **freigeben (Bypass)** | nur gültige, selbst ausgestellte Bearer-Tokens (Audience `…/mcp`), sonst 401 mit `WWW-Authenticate: Bearer resource_metadata=…`; Rechte pro Werkzeug (403 `insufficient_scope`), Rate-Limit 120/min pro Token, Origin-Prüfung für Browser |
| `/oauth/token` | **freigeben (Bypass)** | PKCE, Client-Prüfung, Code einmalig und max. 5 Minuten gültig; Rate-Limit 30/min pro IP. Dient auch als Widerruf-Endpunkt (RFC 7009) |
| `/oauth/register` | **freigeben (Bypass)** | nur Redirect-Adressen mit https oder localhost; Rate-Limit 30/min pro IP. Eine Registrierung allein gibt keinen Zugriff |
| `/.well-known/` (alles darunter) | **freigeben (Bypass)** | gibt nur öffentliche Metadaten heraus (`oauth-protected-resource`, `oauth-protected-resource/mcp`, `oauth-authorization-server`), alles andere 404 |
| `/authorize` | **geschützt lassen** | Access und zusätzlich Prüfung des Access-JWT im Worker (`checkAccess` aus auth.ts, nur `OWNER_EMAIL`); Klick auf „Erlauben“ nötig, Formular an ein Browser-Cookie gebunden |
| `/api/…` inkl. `/api/connector/…` | **geschützt lassen** | Access und `checkAccess` wie bisher |
| alles andere (Oberfläche) | **geschützt lassen** | wie bisher |

Weiterleitungen nach der Zustimmung gehen nur an `https://claude.ai/…`, `https://claude.com/…`, `https://chatgpt.com/…` oder an localhost (Claude Code, mit Warnhinweis auf der Seite). Jede Redirect-Adresse muss exakt der registrierten entsprechen.

### Access einrichten (einmalig, im Cloudflare-Dashboard)

Nur aus der Doku, nicht ausprobiert: Pfad-Regeln in Access gelten für den Pfad und alles darunter, die genauere Anwendung gewinnt.

1. Zero Trust öffnen, links **Access** und dann **Applications**.
2. **Add an application**, **Self-hosted**.
3. Name: `Dashboard Connector (öffentlich)`. Bei **Domain** viermal `dashboard.hahntim518.workers.dev` eintragen, mit den Pfaden `mcp`, `oauth/token`, `oauth/register` und `.well-known`.
4. Policy anlegen: Action **Bypass**, Include **Everyone**. Speichern.
5. Die bestehende Anwendung für das ganze Dashboard nicht ändern. `/authorize` und `/api` bleiben dadurch hinter dem Login.
6. Prüfen (am Computer, ohne angemeldet zu sein):
   - `curl -i https://dashboard.hahntim518.workers.dev/mcp -X POST` gibt **401** mit `www-authenticate: Bearer … resource_metadata=…` (und keine Weiterleitung zu Access).
   - `curl https://dashboard.hahntim518.workers.dev/.well-known/oauth-authorization-server` gibt JSON.
   - `curl -i https://dashboard.hahntim518.workers.dev/authorize` leitet zur Access-Anmeldung weiter.

### Deployment

- `npm run deploy` wie bisher (scripts/deploy.mjs). Der Build ist geprüft (`vite build` und `wrangler deploy --dry-run` mit denselben Schritten).
- Neu im Worker: KV-Binding `OAUTH_KV` (Namespace `dashboard-oauth`, existiert schon), zwei Rate-Limit-Bindings, Variable `MCP_ORIGIN`, Kompatibilitäts-Flag `global_fetch_strictly_public` (Schutz beim Abruf der Client-Metadaten). Keine Durable Objects, keine Migration.
- `OWNER_EMAIL` muss als Secret gesetzt sein (ist es schon, wenn das Dashboard läuft). Ohne sie ist die Zustimmungsseite gesperrt (503).

## Verwalten

Hinter Access unter `/api/connector`:

- `GET /api/connector/grants`: erteilte Zugriffe (Client, Rechte, Redirect, Datum)
- `DELETE /api/connector/grants/<id>`: Zugriff widerrufen, alle Tokens dieses Zugriffs sind sofort ungültig
- `GET /api/connector/clients`: registrierte Clients
- `DELETE /api/connector/clients?client_id=<id>`: Client löschen samt allen Zugriffen

Eine Oberfläche dafür gibt es noch nicht (gehört nicht zu diesem Auftrag).

## Rechte und Werkzeuge

| Recht | Werkzeuge |
|---|---|
| `tasks` | `today_overview`, `list_tasks`, `add_task`, `update_task`, `complete_task` |
| `calendar` | `list_events` |
| `school` | `list_exams`, `add_exam`, `set_exam_topics`, `list_grades`, `add_grade`, `grade_summary`, `get_timetable`, `set_timetable` |
| `gym` | `gym_week`, `log_workout` |
| `money:read` | `money_summary` (nur Zusammenfassung, keine Einzelbuchungen) |
| `health:read` | `health_summary` (nur Zusammenfassung) |
| `notify` | `notify` (Mitteilung aufs Handy: Titel höchstens 60, Text höchstens 180 Zeichen, höchstens 10 pro Tag, Antippen öffnet Ziele) |

Kein Werkzeug löscht; `set_timetable` ersetzt den ganzen Stundenplan durch die übergebene Liste (höchstens 80 Lektionen, ungültige Eingabe ersetzt nichts, leere Liste wird abgelehnt). `grade_summary` lässt Fächer, die in der App auf „zählt nicht zum Schnitt“ stehen, aus Schnitt und Ziel heraus und zeigt sie getrennt unter `notCounted`. Ein Client sieht nur die Werkzeuge, deren Recht du erlaubt hast. `today_overview` zeigt nur die Bereiche, für die das Token Rechte hat. Access-Tokens gelten 30 Minuten, Refresh-Tokens rotieren und verfallen nach 30 Tagen ohne Nutzung.

## Bestehende Verbindungen: neu verbinden?

Nur für `notify`. Die Rechte eines Zugriffs werden beim Verbinden auf der Zustimmungsseite festgelegt und bleiben danach fest (auch ein Refresh erweitert sie nicht, getestet in `test/mcp/tools.test.ts`). Eine App, die vor dieser Version verbunden wurde, hat das Recht `notify` nicht und sieht das Werkzeug nicht: trenne sie unter Einstellungen, Verbundene Apps (oder in Claude beim Connector) und verbinde sie neu, dann taucht `notify` als Haken auf der Zustimmungsseite auf. `get_timetable` und `set_timetable` brauchen kein neues Recht, sie hängen an `school`: eine bestehende Verbindung mit `school` bekommt sie ohne Neuverbinden, sobald die App ihre Werkzeugliste neu lädt (neue Unterhaltung bzw. Connector kurz aus- und einschalten; ob die echte Claude-App die Liste selber auffrischt, ist nicht geprüft).

## Anleitung: in Claude verbinden

Getestet ist der Ablauf lokal mit dem offiziellen MCP-Client (`node test/mcp/durchlauf.mjs` gegen `wrangler dev`), nicht in der echten Claude-App. Die Klickwege stammen aus der Doku von Anthropic.

1. Zuerst Access wie oben einrichten und deployen.
2. Auf claude.ai (Browser am Computer ist am einfachsten) links unten auf deinen Namen, dann **Einstellungen** und **Connectors** (in neueren Versionen **Anpassen**, dann **Connectors**).
3. **Benutzerdefinierten Connector hinzufügen** (Englisch: *Add custom connector*).
4. Name: `Dashboard`. URL: `https://dashboard.hahntim518.workers.dev/mcp`. Bei den erweiterten Einstellungen nichts eintragen (keine Client-ID, kein Secret). **Hinzufügen**.
5. Beim Connector auf **Verbinden**. Es öffnet sich ein Fenster: zuerst die Cloudflare-Anmeldung (wie beim Dashboard), dann die Seite „Zugriff erlauben?“.
6. Prüf auf der Seite: Client heisst Claude, Zugriff geht an **claude.ai**. Wähl die Rechte ab, die Claude nicht haben soll. Dann **Erlauben**.
7. Im Chat über das Plus- oder Werkzeug-Symbol den Connector einschalten und zum Beispiel fragen: „Was steht heute an?“
8. Auf dem iPhone ist der Connector danach in der Claude-App auch da (er hängt am Konto).

## Anleitung: in ChatGPT verbinden

Nur aus der Doku von OpenAI, nicht ausprobiert. Eigene Connectoren gibt es nicht in jedem Abo; die Menünamen ändern sich bei OpenAI oft.

1. Zuerst Access wie oben einrichten und deployen.
2. Auf chatgpt.com am Computer anmelden. In den **Einstellungen** unter **Apps** (früher *Apps & Connectors*) bei **Erweitert** den **Entwicklermodus** einschalten, falls ChatGPT danach fragt.
3. Neue App bzw. eigenen MCP-Server anlegen (*Add custom MCP server* oder **Erstellen**).
4. Name: `Dashboard`, kurze Beschreibung. Verbindung: öffentliche Adresse `https://dashboard.hahntim518.workers.dev/mcp`. Authentifizierung: **OAuth** (ChatGPT findet den Rest selber, keine Client-ID eintragen).
5. Den Risiko-Hinweis bestätigen und erstellen. ChatGPT öffnet die Anmeldung: Cloudflare-Login, dann „Zugriff erlauben?“. Prüf, dass der Zugriff an **chatgpt.com** geht, Rechte wählen, **Erlauben**.
6. ChatGPT zeigt die gefundenen Werkzeuge. In einem neuen Chat die App auswählen und fragen.

## Was getestet ist und was nicht

Getestet (`npx vitest run test/mcp`, 54 Tests, gegen Test-D1 und Test-KV):

- ganzer Ablauf für Claude (`https://claude.ai/api/mcp/auth_callback`) und ChatGPT (`https://chatgpt.com/connector_platform_oauth_redirect`): Registrierung, Zustimmung, Code mit `iss`, Token, Refresh mit Rotation
- Ablehnungen: ohne Token, kaputtes oder fremdes Token, Access-JWT statt Token, abgelaufenes Token, falscher Scope (403 mit Step-up), falsche oder nicht registrierte Redirect-Adresse, fremder Redirect-Host, ohne PKCE, PKCE `plain`, falscher oder fehlender `code_verifier`, Code eines anderen Clients, wiederverwendeter Code, abgelaufener Code, falsche Ressource, altes Refresh-Token nach Rotation, Zustimmung ohne Access-JWT, mit fremder E-Mail, mit falscher Audience, ohne Cookie der Seite, unbekannte Rechte
- Widerruf über `/api/connector` (Zugriff und Client), Rate-Limits, fremde Browser-Herkunft, Connector-Token öffnet `/api` nicht
- jedes Werkzeug mit gültigen und ungültigen Eingaben, inklusive Längengrenzen und dass keine Einzelbuchungen und keine Kalender-Adresse herausgehen
- echter Durchlauf mit `@modelcontextprotocol/client` gegen `wrangler dev`: initialize, tools/list, tools/call, Refresh

Nicht getestet:

- die echten Apps von Claude und ChatGPT und die Access-Regeln in Produktion (nichts deployt)
- Client ID Metadata Documents (der Abruf von `https://claude.ai/oauth/…` bzw. `https://chatgpt.com/oauth/client.json` läuft nur in Produktion; die Bibliothek prüft ihn, eigener Code ist dafür nicht nötig)
- die Rate-Limits von Cloudflare selber (im Test ersetzt)

## Risiken

- KV ist nur „eventuell konsistent“: ein eingelöster Code oder widerrufenes Token kann an einem anderen Cloudflare-Standort bis etwa 60 Sekunden noch gültig scheinen. PKCE verhindert, dass ein abgefangener Code ohne `code_verifier` nützt.
- Wer die Bypass-Regel zu breit setzt (z.B. ganzes `/oauth` oder `/`), öffnet die Zustimmung oder die App. Genau die vier Pfade oben freigeben.
- `/oauth/register` ist öffentlich: jemand kann Clients anlegen (begrenzt durch Rate-Limit, laufen nach 90 Tagen ab), bekommt ohne deinen Klick aber nie ein Token. Unbekannte Clients unter `/api/connector/clients` regelmässig löschen.
- Auf der Zustimmungsseite steht der Name, den der Client selber angibt. Massgebend ist die Zeile „Zugriff geht an“.
