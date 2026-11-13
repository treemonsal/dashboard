// Startdaten: Fächer und die Prüfungen aus Tims Google Kalender (Stand der Einträge 13.9.2026).
// Aufruf: node scripts/seed.mjs --local | --remote
// Mehrfach ausführbar: feste IDs und INSERT OR IGNORE, vorhandene Einschätzungen bleiben erhalten.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv.includes("--remote") ? "--remote" : "--local";

// Fächer laut Kalender (Plan, Nachtrag 13.11.)
const subjects = ["E", "T+U", "HKB e", "W+R", "FRW", "M"];
const subjectId = (code) => "s-" + code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

// Alle Zeiten lokal in Europe/Zurich.
const exams = [
  { id: "x-wr-20261127", s: "W+R", title: "Kapitel 3: Organisation und Personal", date: "2026-11-27", start: "10:10", end: "11:50", room: "LI208", source: "Teams, W+R, Terminplan 1. Semester", topics: ["Kapitel 3: Organisation", "Kapitel 3: Personal"] },
  { id: "x-frw-20261203", s: "FRW", title: "Kapitel 11 bis 17", date: "2026-12-03", start: "09:15", end: "11:50", room: "LI208", source: "Teams, FRW, Terminplan 1. Semester", topics: ["Kapitel 11", "Kapitel 12", "Kapitel 13", "Kapitel 14", "Kapitel 15", "Kapitel 16", "Kapitel 17"] },
  { id: "x-tu-20261204", s: "T+U", title: "Solar system", date: "2026-12-04", start: "08:15", end: "10:00", room: "LI121", source: "Teams, T+U, tests term 1", topics: ["Solar system"] },
  { id: "x-e-20261211", s: "E", title: "CAE/CPE listening", date: "2026-12-11", start: "06:30", end: "08:05", room: "LI121", source: "Teams, E, Forthcoming tests", hint: "Uhrzeit prüfen", topics: ["CAE/CPE listening"] },
  { id: "x-m-20270107", s: "M", title: "Test 3: Rational numbers", date: "2027-01-07", start: "08:15", end: "09:00", room: "LI220", source: "Teams, M, Jahresplan 2026-2027", topics: ["Rational numbers"] },
  { id: "x-wr-20270122", s: "W+R", title: "Kapitel 4 und 5, zählt fürs 2. Semester", date: "2027-01-22", start: "10:10", end: "11:50", room: "LI208", source: "Teams, W+R, Terminplan 1. Semester", topics: ["Kapitel 4", "Kapitel 5"] },
];

const q = (v) => (v == null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);
const lines = [];
subjects.forEach((code, i) => lines.push(`INSERT OR IGNORE INTO subjects (id, code, sort_order) VALUES (${q(subjectId(code))}, ${q(code)}, ${i});`));
for (const e of exams) {
  // Status "bestaetigt": die Einträge stehen bereits mit Quelle im Kalender. Der Sonntagslauf prüft sie gegen die Quelle.
  lines.push(
    `INSERT OR IGNORE INTO exams (id, subject_id, title, date, start_time, end_time, room, source, status, hint) VALUES (${[
      e.id, subjectId(e.s), e.title, e.date, e.start, e.end, e.room, e.source, "bestaetigt", e.hint ?? null,
    ].map(q).join(", ")});`,
  );
  e.topics.forEach((t, i) =>
    lines.push(`INSERT OR IGNORE INTO exam_topics (id, exam_id, title, assessment, sort_order) VALUES (${q(`${e.id}-t${i + 1}`)}, ${q(e.id)}, ${q(t)}, 0, ${i});`),
  );
}

const dir = mkdtempSync(join(tmpdir(), "seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, lines.join("\n") + "\n");
execFileSync("npx", ["wrangler", "d1", "execute", "dashboard", target, "--file", file, "-y"], { stdio: "inherit" });
console.log(`Startdaten eingespielt (${target}): ${subjects.length} Fächer, ${exams.length} Prüfungen.`);
