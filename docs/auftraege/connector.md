# Auftrag: Connector (Remote-MCP-Server) für Claude und ChatGPT

Dein Bereich: src/server/mcp/**, test/mcp/**, src/server/index.ts, wrangler.jsonc, package.json (nur Abhängigkeiten), docs/connector.md. Keine Migrationen, keine Änderungen an routes.ts, schema.ts, auth.ts oder der Oberfläche. OAuth-Zustand in einen KV-Namespace, nicht in D1.

1. Aktuelle Doku prüfen statt Vorwissen: MCP-Spezifikation (Streamable HTTP, OAuth 2.1, Protected Resource Metadata, Client-Registrierung), `@cloudflare/workers-oauth-provider` und MCP-Hilfen auf Workers, Anforderungen von Claude und ChatGPT an Custom Connectors. Schlanksten Weg wählen, der in beiden funktioniert, in docs/connector.md in drei Sätzen begründen.
2. Sicherheit, verbindlich:
- Zustimmungsseite bleibt hinter Cloudflare Access und prüft zusätzlich das Access-JWT über auth.ts. Sie zeigt Client-Name, Redirect-Adresse, Rechte und verlangt einen ausdrücklichen Klick.
- /mcp, Token-, Registrierungs- und Metadaten-Endpunkte müssen ohne Access-Cookie erreichbar sein und dürfen sich nicht auf Access verlassen: /mcp akzeptiert nur gültige Tokens des eigenen OAuth-Servers, sonst 401 mit korrektem WWW-Authenticate. docs/connector.md nennt exakt, welche Pfade in Access freizugeben sind und welche geschützt bleiben.
- PKCE Pflicht, exakte Redirect-Prüfung, kurze Access-Tokens mit Refresh, Tokens nur gehasht, Widerruf. API unter /api (hinter Access) zum Auflisten und Widerrufen von Clients und Zugriffen.
- Rechte: tasks (lesen, schreiben), calendar (lesen), school (Noten und Prüfungen lesen, anlegen), gym (lesen, Training eintragen), money:read und health:read (nur Zusammenfassungen). Kein Werkzeug löscht. zod überall, Textlängen begrenzen, Datenbankinhalte strukturiert als Daten zurückgeben. Rate-Limit pro Token.
3. Werkzeuge (Beschreibungen kurz, Englisch): today_overview; list_tasks, add_task, update_task, complete_task; list_exams, add_exam, set_exam_topics, list_grades, add_grade, grade_summary; gym_week, log_workout; money_summary; health_summary; list_events. Vorhandene Rechenfunktionen aus src/shared nutzen. schema.ts am Ende noch einmal lesen.
4. Tests in test/mcp: ganzer OAuth-Ablauf, alle Ablehnungen (ohne Token, falscher Scope, falsche Redirect-URI, abgelaufener oder wiederverwendeter Code), jedes Werkzeug gegen Test-D1, /mcp ohne Access-Header geht, Zustimmung ohne Access nicht. Dazu lokal ein echter MCP-Durchlauf (initialize, tools/list, tools/call) per Skript.
5. Der Einstieg in index.ts muss mit scripts/deploy.mjs bauen. Durable Objects vermeiden, wenn es ohne geht; sonst Binding und Migration sauber eintragen und deutlich melden.
6. docs/connector.md: Entscheidung, Pfade für Access, Klickanleitung für Einsteiger (Deutsch, per Du) für Claude und ChatGPT mit der Adresse https://dashboard.hahntim518.workers.dev/mcp. Ehrlich kennzeichnen, was nur aus Doku stammt.

Schlussbericht kurz: gewählter Weg, getestet, nicht getestet, was für Deployment und Access zu tun ist, Risiken.
