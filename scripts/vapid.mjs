// Erzeugt ein VAPID-Schlüsselpaar für Web Push (ECDSA P-256, Web Crypto).
// Der öffentliche Schlüssel wird ausgegeben und nach src/shared/push-public.ts geschrieben.
// Der private Schlüssel geht NUR über stdin an `wrangler secret put VAPID_PRIVATE_KEY`:
// nie in eine Datei, nie in die Ausgabe.
// Aufruf: node scripts/vapid.mjs [--force]   (--force ersetzt ein vorhandenes Paar; alle Abos müssen dann neu angelegt werden)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/shared/push-public.ts", import.meta.url);
const ACC = "0769eb3231c64f3d073e4241a70ed967";
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

if (existsSync(FILE) && /VAPID_PUBLIC_KEY\s*=\s*"B[\w-]{60,}"/.test(readFileSync(FILE, "utf8")) && !process.argv.includes("--force")) {
  console.error("Es gibt schon einen öffentlichen Schlüssel in src/shared/push-public.ts. Mit --force ersetzen (bestehende Abos werden dann ungültig).");
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

const r = spawnSync("npx", ["wrangler", "secret", "put", "VAPID_PRIVATE_KEY"], {
  input: privateKey + "\n",
  encoding: "utf8",
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACC, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "dummy" },
});
const scrub = (s) => (s ?? "").split(privateKey).join("***");
if (r.status !== 0) {
  console.error("Secret konnte nicht gesetzt werden, nichts geschrieben.");
  console.error(scrub(r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n"));
  process.exit(1);
}
console.log(scrub(r.stdout).trim().split("\n").slice(-2).join("\n"));

writeFileSync(
  FILE,
  `// Öffentlicher VAPID-Schlüssel (unkomprimiert, base64url). Öffentlich, darf im Code stehen.\n// Erzeugt von scripts/vapid.mjs. Der private Schlüssel liegt nur als Secret VAPID_PRIVATE_KEY bei Cloudflare.\nexport const VAPID_PUBLIC_KEY = "${publicKey}";\n`,
);
console.log("Öffentlicher Schlüssel:", publicKey);
console.log("Geschrieben nach src/shared/push-public.ts");
