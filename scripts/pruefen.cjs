// Browser-Durchlauf gegen `wrangler dev` (http://localhost:8787): 1200px und 400px, dunkel und hell.
// Prüft: keine horizontale Scrollleiste, keine Konsolenfehler, Service Worker aktiv, optimistische Updates.
// Aufruf: node scripts/pruefen.cjs [basis-url]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.argv[2] || "http://localhost:8787";
const OUT = path.join(__dirname, "../docs/screens");
const PAGES = [
  ["heute", "/"],
  ["aufgaben", "/aufgaben"],
  ["schule", "/schule"],
  ["pruefung", "/schule/pruefungen/x-e-20261211"],
  ["kalender", "/kalender"],
];
const SHOTS = new Set(["heute", "pruefung", "schule"]);
let failures = 0;
// Wartet höchstens 300 ms auf einen Zustand (deutlich kürzer als die künstliche Serververzögerung von 800 ms).
const soon = async (loc, attr, value) => {
  for (let t = 0; t < 30; t++) {
    if ((await loc.getAttribute(attr)) === value) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};
const fail = (m) => {
  failures++;
  console.log("FEHLER", m);
};

(async () => {
  const browser = await chromium.launch();
  for (const width of [1200, 400]) {
    for (const theme of ["dunkel", "hell"]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 400 ? 860 : 900 }, deviceScaleFactor: width === 400 ? 2 : 1 });
      if (theme === "hell") await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const [name, url] of PAGES) {
        await page.goto(BASE + url, { waitUntil: "networkidle" });
        await page.waitForTimeout(250);
        const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        if (sw > cw) fail(`${width}px ${theme} ${name}: horizontale Scrollleiste (${sw} > ${cw})`);
        if (SHOTS.has(name)) await page.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}.png`), fullPage: true });
      }
      const swOk = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
      if (!swOk) fail(`${width}px ${theme}: kein Service Worker`);
      if (errors.length) fail(`${width}px ${theme}: Konsolenfehler: ${errors.join(" | ")}`);
      console.log(`${width}px ${theme}: geprüft`);
      await ctx.close();
    }
  }

  // Optimistische Updates
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/schule/pruefungen/x-frw-20261203", { waitUntil: "networkidle" });
  // Antworten künstlich verzögern, damit die sofortige Reaktion messbar ist
  await page.route("**/api/exam-topics/**", async (r) => {
    await new Promise((res) => setTimeout(res, 800));
    await r.continue();
  });
  const sitzt = page.getByRole("group", { name: "Einschätzung Kapitel 11" }).getByRole("button", { name: "sitzt" });
  await sitzt.click();
  if (!(await soon(sitzt, "aria-pressed", "true"))) fail("Einschätzung reagiert nicht sofort");
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.getByRole("group", { name: "Einschätzung Kapitel 11" }).getByRole("button", { name: "sitzt" }).getAttribute("aria-pressed")) !== "true")
    fail("Einschätzung nicht gespeichert");
  await page.unroute("**/api/exam-topics/**");
  await page.getByRole("group", { name: "Einschätzung Kapitel 11" }).getByRole("button", { name: "offen" }).click();
  await page.waitForTimeout(500);

  await page.goto(BASE + "/aufgaben", { waitUntil: "networkidle" });
  await page.route("**/api/tasks**", async (r) => {
    if (r.request().method() !== "GET") await new Promise((res) => setTimeout(res, 800));
    await r.continue();
  });
  const title = `Playwright-Testaufgabe ${Date.now()}`;
  await page.fill("#new-task", title);
  await page.click("button[type=submit]");
  const row = page.getByRole("button", { name: title });
  try {
    await row.waitFor({ timeout: 300 });
  } catch {
    fail("Neue Aufgabe erscheint nicht sofort");
  }
  await page.waitForTimeout(1200);
  await row.click();
  if (!(await soon(row, "aria-pressed", "true"))) fail("Abhaken reagiert nicht sofort");
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.getByRole("button", { name: title }).getAttribute("aria-pressed")) !== "true") fail("Abhaken nicht gespeichert");
  console.log("Optimistische Updates: geprüft");
  await ctx.close();

  await browser.close();
  // Testaufgaben wieder entfernen (nur lokale Datenbank)
  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    require("child_process").execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "dashboard", "--local", "--command", "DELETE FROM tasks WHERE title LIKE 'Playwright-Testaufgabe%'"],
      { stdio: "ignore" },
    );
  }
  console.log(failures ? `${failures} Fehler` : "Alles in Ordnung");
  process.exit(failures ? 1 : 0);
})();
