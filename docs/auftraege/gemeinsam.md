# Gilt für jeden Agenten in diesem Projekt

- Zuerst docs/profil.md lesen. Stil der Oberfläche: nur dunkel, fast keine Farbe, wenig Text, Deutsch mit Schweizer Rechtschreibung (ss statt ß), keine Emojis, keine Ladekreisel, vorhandene Bausteine und Blätter mit Gesten benutzen.
- Cloudflare: CLOUDFLARE_ACCOUNT_ID=0769eb3231c64f3d073e4241a70ed967 und CLOUDFLARE_API_TOKEN=dummy setzen. Der Proxy meldet an. Nie ein echtes Token suchen oder speichern. Keine Geheimnisse in Dateien, Ausgaben oder Berichten.
- Die Sitzung kann jederzeit neu starten und laufende Arbeit abbrechen. Deshalb: nach jedem lauffähigen Teilschritt festhalten (git add nur der eigenen Dateien, commit mit user.name "Tim Hahn", user.email "hahntim518@users.noreply.gitlab.com", ohne Modellnamen) und in docs/auftraege/stand-<name>.md in drei Zeilen notieren, was fertig ist und was als Nächstes kommt. Wird ein Commit abgelehnt: Dateien liegen lassen, melden, nicht umgehen.
- Prüfen: `npm run check`, `npx vitest run`, für Oberfläche zusätzlich `npx wrangler dev` und Playwright (vorinstalliert, require('playwright'), nichts installieren, Viewport 393x852, dunkel).
- Nicht deployen, keine Access-Regeln ändern, nichts in der Remote-Datenbank löschen, keine weiteren Agenten starten.
