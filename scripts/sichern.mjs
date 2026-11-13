// Sichert alle von git verfolgten Dateien per GitLab-API (git push ist in der Cloud-Sitzung nicht moeglich).
// Aufruf: node scripts/sichern.mjs "Nachricht"
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const P = "https://gitlab.com/api/v4/projects/88918192/repository";
const msg = process.argv[2] || "Sicherung";
const files = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n");
const remote = new Map();
for (let page = 1; ; page++) {
  const r = await fetch(`${P}/tree?recursive=true&per_page=100&page=${page}&ref=main`);
  if (!r.ok) break;
  const t = await r.json();
  t.filter(x => x.type === "blob").forEach(x => remote.set(x.path, x.id));
  if (t.length < 100) break;
}
const actions = [];
for (const f of files) {
  const buf = readFileSync(f);
  const sha = execSync(`git hash-object "${f}"`, { encoding: "utf8" }).trim();
  if (remote.get(f) === sha) continue;
  actions.push({ action: remote.has(f) ? "update" : "create", file_path: f, encoding: "base64", content: buf.toString("base64") });
}
for (const f of remote.keys()) if (!files.includes(f)) actions.push({ action: "delete", file_path: f });
if (!actions.length) { console.log("nichts zu sichern"); process.exit(0); }
const r = await fetch(`${P}/commits`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ branch: "main", commit_message: msg, actions }) });
console.log(r.status, actions.length, "Dateien", r.ok ? "" : await r.text());
process.exit(r.ok ? 0 : 1);
