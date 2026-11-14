# Auftrag: Feinschliff der Oberfläche

Tabu: src/server/mcp/**, src/server/health/**, src/client/fitbit.tsx (gehören anderen).

1. Durchsicht aller Bildschirme und Blätter gegen docs/entwurf-v3.html und docs/profil.md. Starte `npx wrangler dev`, klick mit Playwright (393x852, dunkel) durch jede Seite und jedes Blatt, sieh dir jeden Screenshot selber an. Suche gezielt nach dem, was nach Baukasten oder KI aussieht, und behebe es:
- uneinheitliche Abstände, Radien, Schriftgrössen (alles muss aus tokens.css kommen, keine Einzelwerte in Komponenten)
- Text, der nur wiederholt, was die Form schon zeigt; Untertitel, Erklärsätze, doppelte Überschriften
- Farbe ohne Bedeutung, Verläufe, Schatten
- abgeschnittene oder umbrechende Titel, zu enge Tippziele, Inhalte unter der Tab-Leiste (unten genug Platz, damit das Letzte frei scrollt)
- Leerzustände: je ein ruhiger Satz und genau eine Handlung
- Zahlen: Tabellenziffern, Rappen klein, Tausender mit schmalem Abstand
Führe eine Liste "gefunden / behoben" in docs/auftraege/stand-feinschliff.md.
2. Gym-Raster und Woche: vergangene geplante Trainingstage ohne Training klar von "nicht geplant" unterscheiden (z.B. dünner Rand statt Fläche), ohne Text. Der Sonntag als Wackeltag muss auf einen Blick lesbar sein.
3. Einstellungen, Abschnitt "Verbundene Apps": Clients und Zugriffe des Connectors auflisten und widerrufen (API unter /api/connector, siehe docs/connector.md), mit Bestätigung im Blatt. Leerzustand: "Noch keine App verbunden" mit der Connector-Adresse zum Kopieren.
4. Einstellungen: Abschnitt "Abgleich" mit den letzten Läufen aus sync_runs (Kalender, Schule, Fitbit), je Zeitpunkt und ob es geklappt hat.
5. Startseite, kleine Dringlichkeit ohne Kitsch: unter dem Tagesring eine einzige Zeile mit der verbleibenden wachen Zeit bis 22:00 als schmaler Balken (aus den Einstellungen), sonst nichts Neues.
6. Tagesplan lernt mit (erste Stufe): Aus task_events (Wochentag, Uhrzeit, Dauer beim Erledigen) Vorschläge für Aufgaben ohne Uhrzeit ableiten: reine Funktion in src/shared mit Tests (z.B. Median der Uhrzeit ähnlicher Aufgaben am selben Wochentag, freie Lücken zwischen Terminen, Arbeit Mo bis Mi und Schule Do und Fr tagsüber gesperrt, nichts nach 21:30). In der Oberfläche als gedämpfte Uhrzeit mit einem Tipp zum Übernehmen. Ohne genug Daten: nichts vorschlagen.
Am Ende alle Screenshots in docs/screens neu erzeugen (alte löschen), `npm run check` und `npx vitest run` grün.
