// Echter MCP-Durchlauf gegen einen laufenden Worker (wrangler dev), wie ein Client ihn macht:
// 401 -> Metadaten -> Registrierung -> Zustimmung (lokal ohne Access, nur auf localhost) -> Token -> initialize, tools/list, tools/call.
// Aufruf: npx wrangler dev --port 8799   und dann   node test/mcp/durchlauf.mjs http://localhost:8799
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const base = (process.argv[2] ?? "http://localhost:8799").replace(/\/+$/, "");
const redirect = "http://localhost:33418/callback";
const b64 = (b) => b.toString("base64url");
const step = (s, ...a) => console.log(`- ${s}`, ...a);
const fail = (m) => {
  console.error(`FEHLER: ${m}`);
  process.exit(1);
};

// 1. /mcp ohne Token
const r401 = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
const www = r401.headers.get("www-authenticate") ?? "";
if (r401.status !== 401 || !www.includes("resource_metadata=")) fail(`erwartet 401 mit resource_metadata, bekam ${r401.status} ${www}`);
step("401 ohne Token:", www);

// 2. Metadaten
const prm = await (await fetch(/resource_metadata="([^"]+)"/.exec(www)[1])).json();
const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
step("Ressource", prm.resource, "Aussteller", asm.issuer);

// 3. Registrierung
const reg = await fetch(asm.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Durchlauf", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
});
if (reg.status !== 201) fail(`Registrierung ${reg.status} ${await reg.text()}`);
const { client_id } = await reg.json();
step("registriert", client_id);

// 4. Zustimmung
const verifier = b64(randomBytes(32));
const challenge = b64(createHash("sha256").update(verifier).digest());
const scopes = ["tasks", "calendar", "school", "gym", "money:read", "health:read"];
const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirect, scope: scopes.join(" "), state: "s1", code_challenge: challenge, code_challenge_method: "S256", resource: prm.resource });
const page = await fetch(`${asm.authorization_endpoint}?${q}`, { redirect: "manual" });
const html = await page.text();
const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
if (page.status !== 200 || !handle) fail(`Zustimmungsseite ${page.status}: ${html.slice(0, 200)}`);
const cookie = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const form = new URLSearchParams({ handle, decision: "approve" });
for (const s of scopes) form.append("scope", s);
const approved = await fetch(asm.authorization_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: base }, body: form, redirect: "manual" });
const loc = new URL(approved.headers.get("location") ?? "about:blank");
const code = loc.searchParams.get("code");
if (approved.status !== 302 || !code) fail(`Zustimmung ${approved.status} ${loc}`);
if (loc.searchParams.get("iss") !== asm.issuer) fail("iss fehlt in der Antwort");
step("Code erhalten, iss", loc.searchParams.get("iss"));

// 5. Token
const tr = await fetch(asm.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id, code_verifier: verifier, resource: prm.resource }),
});
const tok = await tr.json();
if (tr.status !== 200) fail(`Token ${tr.status} ${JSON.stringify(tok)}`);
step("Token: gültig", tok.expires_in, "s, Rechte", tok.scope);

// 6. MCP mit dem offiziellen Client-SDK
const transport = new StreamableHTTPClientTransport(new URL(prm.resource), { requestInit: { headers: { authorization: `Bearer ${tok.access_token}` } } });
const client = new Client({ name: "durchlauf", version: "1.0.0" });
await client.connect(transport);
step("initialize:", JSON.stringify(client.getServerVersion()));
const { tools } = await client.listTools();
step(`tools/list: ${tools.length} Werkzeuge:`, tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "today_overview", arguments: {} });
if (res.isError) fail(`today_overview: ${res.content?.[0]?.text}`);
step("tools/call today_overview:", JSON.stringify(res.structuredContent).slice(0, 300));
const add = await client.callTool({ name: "list_tasks", arguments: { view: "today", limit: 3 } });
step("tools/call list_tasks:", JSON.stringify(add.structuredContent).slice(0, 200));
await client.close();

// 7. Refresh
const rr = await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id }) });
if (rr.status !== 200) fail(`Refresh ${rr.status}`);
step("Refresh ok");
console.log("Durchlauf erfolgreich.");
