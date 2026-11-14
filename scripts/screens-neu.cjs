// Screenshots der Bereiche nach dem Feinschliff (Heute mit Restzeit und Vorschlägen, Woche, Gym-Raster, Einstellungen, verbundene Apps).
// Erwartet `wrangler dev` mit Beispieldaten (Gym-Einträge, Erledigungen aus mehreren Wochen) und die feste Zeit Sa 14.11.2026 14:20.
// Aufruf: node scripts/screens-neu.cjs [basis-url]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.argv[2] || "http://localhost:8787";
const OUT = path.join(__dirname, "../docs/screens");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: "dark", serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date("2026-11-14T14:20:00+01:00") });
  const grants = [{ id: "g1", clientId: "c1", clientName: "Claude", scope: ["tasks", "calendar", "gym", "school"], redirectUri: "https://claude.ai/api/mcp/auth_callback", createdAt: "2026-11-10T08:00:00.000Z", expiresAt: null }];
  let withGrants = false;
  await p.route("**/api/connector/grants", (r) => r.fulfill({ json: withGrants ? grants : [] }));
  const go = async (u) => { await p.goto(BASE + u); await p.waitForSelector(".app"); await p.clock.runFor(800); await wait(500); };
  const shot = (n, full = true) => p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: full });
  await go("/"); await shot("50-heute-restzeit-vorschlaege");
  await go("/woche"); await shot("51-woche-verpasst");
  await go("/ziele"); await shot("52-ziele-gym-raster");
  await go("/einstellungen"); await shot("53-einstellungen-apps-leer");
  withGrants = true;
  await go("/einstellungen");
  await p.locator(".row", { hasText: "Claude" }).click(); await p.waitForSelector(".sheet"); await wait(600);
  await shot("54-blatt-app-widerrufen", false);
  await p.locator(".sheet button", { hasText: "Zugriff widerrufen" }).click(); await wait(300);
  await shot("55-blatt-app-bestaetigen", false);
  await browser.close();
})();
