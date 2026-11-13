// Veroeffentlichen aus der Cloud-Sitzung: Oberflaeche in den KV-Speicher, Worker ohne Assets-Upload.
// Aufruf: CLOUDFLARE_API_TOKEN=dummy node scripts/deploy.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
const ACC = "0769eb3231c64f3d073e4241a70ed967";
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACC, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "dummy" };
execSync("npx vite build", { stdio: "inherit", env });
const cfg = JSON.parse(readFileSync("dist/dashboard/wrangler.json", "utf8"));
const kv = cfg.kv_namespaces.find(k => k.binding === "STATIC").id;
const files = [];
const walk = d => readdirSync(d).forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk("dist/client");
const items = files.filter(f => !f.endsWith(".assetsignore") && !f.endsWith(".map"))
  .map(f => ({ key: f.slice("dist/client".length), value: readFileSync(f).toString("base64"), base64: true }));
const r = execSync(`curl -sS -m 120 -X PUT https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${kv}/bulk -H 'Content-Type: application/json' --data-binary @-`, { input: JSON.stringify(items), encoding: "utf8", maxBuffer: 1e8 });
if (!JSON.parse(r).success) { console.error(r); process.exit(1); }
console.log("Oberflaeche:", items.length, "Dateien im KV");
delete cfg.assets;
mkdirSync("dist/deploy", { recursive: true });
copyFileSync("dist/dashboard/index.js", "dist/deploy/index.js");
copyFileSync("dist/dashboard/index.js.map", "dist/deploy/index.js.map");
cfg.main = "index.js"; cfg.no_bundle = true; delete cfg.configPath; delete cfg.userConfigPath;
writeFileSync("dist/deploy/wrangler.json", JSON.stringify(cfg, null, 2));
execSync("npx wrangler deploy -c dist/deploy/wrangler.json", { stdio: "inherit", env });
