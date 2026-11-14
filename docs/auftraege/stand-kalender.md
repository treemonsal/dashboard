# Stand Kalender, Wiederholungen, Erinnerungen
Fertig und geprüft: ICS-Leser, Abgleich, Routen, Wiederholungen, Push-Versand, Tests (320 grün, check grün), Service Worker, Oberfläche (Heute, Woche, Termin-Blatt, Wiederholung, Einstellungen), Browserdurchlauf, Migration 0004 remote angewendet, Screenshots 50 bis 59.
Offen: index.ts braucht scheduled-Handler (runScheduled aus src/server/cron.ts), wrangler.jsonc braucht triggers.crons ["*/5 * * * *"]; VAPID-Secret setzen (node scripts/vapid.mjs); echter Push aufs iPhone ungeprüft.
