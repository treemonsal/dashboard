# Stand Fitbit / Google Health
Fertig und geprüft: Google Health API v4 gewählt (Fitbit Web API abgeschaltet), Server src/server/health, Migration 0005, Einhängung in routes.ts, cron.ts, Einstellungen und Körper-Tab, src/client/fitbit.tsx, 38 Tests in test/health, docs/fitbit.md; npm run check und 368 Tests grün.
Offen: Migration 0005 remote nicht angewendet (Befehl wurde vom Berechtigungsprüfer abgelehnt): npm run db:migrate:remote; Secrets GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET, HEALTH_TOKEN_KEY setzen (Schritte in docs/fitbit.md); deployen.
Ungeprüft: echter Durchlauf gegen Google (Zugangsdaten fehlen), Veröffentlichen ohne Verifizierung, Altersgrenze (Tim ist 15), Rückkehr hinter Access.
