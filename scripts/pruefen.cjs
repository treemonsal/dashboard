// Browser-Durchlauf gegen `wrangler dev` (http://localhost:8787), iPhone-Format 393x852, dunkel.
// Klickt durch alle Ebenen, testet Ziehen von Blättern und Wischen von Zeilen mit echten Mausbewegungen,
// prüft Konsolenfehler und horizontalen Überlauf und legt Screenshots nach docs/screens/ ab.
// Aufruf: node scripts/pruefen.cjs [basis-url]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.argv[2] || "http://localhost:8787";
const OUT = path.join(__dirname, "../docs/screens");
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FEHLER", m); } else console.log("ok    ", m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, url, body, method = "POST") => p.evaluate(async ([u, b, m]) => (await fetch("/api" + u, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).status, [url, body, method]);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: "dark", serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  const shot = (n, full = false) => p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: full });
  const go = async (u) => { await p.goto(BASE + u); await p.waitForSelector(".app"); await wait(500); };
  const overflow = async (n) => ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `kein horizontaler Überlauf: ${n}`);
  const sheetY = () => p.evaluate(() => { const s = document.querySelector(".sheet"); return s ? new DOMMatrix(getComputedStyle(s).transform).m42 : null; });
  const closeSheet = async () => { await p.keyboard.press("Escape"); await wait(600); };
  const tapTargets = async (n) => {
    const small = await p.evaluate(() => [...document.querySelectorAll("button, a, input, select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5) && !e.closest(".gym") && !e.closest(".qe input"); }).map((e) => (e.getAttribute("aria-label") || e.textContent || e.className).slice(0, 24) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    ok(small.length === 0, `Tippziele >= 44px: ${n} ${small.slice(0, 4).join(" | ")}`);
  };

  /* ---- Heute leer ---- */
  await go("/");
  await shot("01-heute-leer", true);
  await overflow("Heute");

  /* ---- Aufgaben: Schnelleingabe ---- */
  await go("/aufgaben");
  const input = p.locator(".qe input");
  await input.fill("Franz lernen heute 18 Uhr 30 min");
  ok((await p.locator(".qe .chips span").allTextContents()).join(",").includes("18:00"), "Schnelleingabe zeigt erkannte Uhrzeit");
  await shot("02-aufgaben-eingabe");
  await input.press("Enter");
  await wait(80);
  ok((await p.locator(".swipe").count()) === 1, "Neue Aufgabe erscheint sofort in Heute (80 ms, Server braucht länger)");
  await input.fill("Zimmer aufräumen");
  await input.press("Enter");
  await p.locator(".seg button", { hasText: "Eingang" }).click();
  ok((await p.locator(".swipe").count()) === 1, "Aufgabe ohne Datum landet im Eingang");
  await input.fill("Bericht schreiben morgen 45 min");
  await input.press("Enter");
  ok((await p.locator(".seg button[aria-pressed=true]").innerText()).startsWith("Demnächst"), "Aufgabe mit Datum wechselt zu Demnächst");
  await shot("03-aufgaben-demnaechst");
  await input.fill("Heute offen");
  await input.press("Enter");
  await input.fill("Physik Test vorbereiten heute");
  await input.press("Enter");
  await wait(600);
  await p.locator(".seg button", { hasText: "Projekte" }).click();
  await p.locator("form.card input").fill("Lehrbetrieb");
  await p.locator("form.card input").press("Enter");
  await wait(400);
  await shot("04-aufgaben-projekte");
  await tapTargets("Aufgaben");
  await overflow("Aufgaben");

  /* ---- Pläne (vor Heute, damit Training heute existiert) ---- */
  await go("/plaene");
  await shot("05-plaene");
  await p.locator(".lrow", { hasText: "Oberkörper" }).click();
  await p.waitForSelector(".sheet");
  await wait(600);
  await shot("06-plan-blatt-leer");
  await p.locator(".days button", { hasText: "Sa" }).click();
  await p.locator(".sheet button.chip", { hasText: "Übungen hinzufügen" }).click();
  await p.locator("input[aria-label=Übung]").fill("Bankdrücken");
  await p.locator("input[aria-label=Gewicht]").fill("40");
  await p.locator(".sheet button.link").click();
  await p.locator("input[aria-label=Übung]").nth(1).fill("Rudern");
  await shot("07-plan-blatt-uebungen");
  await p.locator(".cta", { hasText: "Speichern" }).click();
  await wait(900);
  ok((await p.locator(".lrow", { hasText: "Oberkörper" }).innerText()).includes("2 Übungen"), "Plan gespeichert (2 Übungen)");
  await p.locator("button.cta", { hasText: "Plan anlegen" }).click();
  await p.waitForSelector(".sheet");
  await wait(500);
  await p.locator("input[aria-label=Name]").fill("Beine");
  await p.locator(".days button", { hasText: "Mo" }).click();
  await p.locator(".cta", { hasText: "Speichern" }).click();
  await wait(700);
  ok((await p.locator(".lrow").count()) === 3, "Neuer Plan angelegt");
  await p.locator(".lrow", { hasText: "Beine" }).click();
  await wait(600);
  await p.locator("button", { hasText: "Plan löschen" }).click();
  await p.locator("button", { hasText: "Wirklich löschen" }).click();
  await wait(800);
  ok((await p.locator(".lrow").count()) === 2, "Plan mit Bestätigung gelöscht");
  await tapTargets("Pläne");
  await overflow("Pläne");

  /* ---- Heute mit Daten ---- */
  await go("/");
  await wait(400);
  await shot("08-heute-daten", true);
  await overflow("Heute mit Daten");
  const ringText = async () => (await p.locator(".dring .n").innerText()).replace(/\s/g, "");
  const before = await ringText();
  // Wischen nach links = erledigt (echte Mausbewegung, schnell in Schritten)
  const row = p.locator(".swipe", { hasText: "Physik" }).first();
  await row.evaluate((e) => e.scrollIntoView({ block: "center" })); await wait(200);
  const bb = await row.boundingBox();
  await p.mouse.move(bb.x + bb.width - 80, bb.y + bb.height / 2);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width - 130, bb.y + bb.height / 2, { steps: 4 });
  const mid = await row.locator(".over").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  ok(mid < -30 && mid > -80, `Zeile folgt dem Finger beim Wischen (x=${Math.round(mid)})`);
  await shot("09-wischen-mitte");
  await p.mouse.move(bb.x + 20, bb.y + bb.height / 2, { steps: 6 });
  await p.mouse.up();
  await wait(900);
  const after = await ringText();
  ok(before !== after, `Wischen erledigt die Aufgabe (Ring ${before} -> ${after})`);
  const back = await row.locator(".over").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  ok(Math.abs(back) < 2, "Zeile federt nach dem Wischen zurück");
  // kurzes Wischen unter der Schwelle: nichts passiert
  const row2 = p.locator(".swipe", { hasText: "Franz" }).first();
  await row2.evaluate((e) => e.scrollIntoView({ block: "center" })); await wait(200);
  const b2 = await row2.boundingBox();
  await p.mouse.move(b2.x + 230, b2.y + 28); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(b2.x + 230 - i * 6, b2.y + 28); await wait(60); } await wait(120); await p.mouse.up(); await wait(700);
  ok((await ringText()) === after, "Unter der Schwelle bleibt die Aufgabe offen");

  // Rückmeldung bei pointerdown
  const hero = p.locator(".hero");
  await p.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  const hb = await hero.boundingBox();
  await p.mouse.move(hb.x + 40, hb.y + 40); await p.mouse.down();
  const sc = await hero.evaluate((e) => getComputedStyle(e).transform);
  await wait(150);
  const sc2 = await hero.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  ok(sc2 < 0.985 && sc2 > 0.95, `Rückmeldung sofort bei pointerdown (scale ${sc2.toFixed(3)})`);
  await p.mouse.move(hb.x + 40, hb.y + 40); await p.mouse.up();

  /* ---- Tagesring-Blatt und Ziehen ---- */
  await p.waitForSelector(".sheet");
  await wait(700);
  await shot("10-blatt-tag");
  ok((await sheetY()) !== null && (await sheetY()) < 2, "Blatt offen (y=0)");
  const grab = await p.locator(".grab").boundingBox();
  const gx = grab.x + grab.width / 2, gy = grab.y + grab.height / 2;
  await p.mouse.move(gx, gy); await p.mouse.down();
  await p.mouse.move(gx, gy + 60, { steps: 6 });
  const y60 = await sheetY();
  ok(Math.abs(y60 - 60) < 6, `Blatt folgt dem Finger 1:1 (y=${y60?.toFixed(1)} bei 60)`);
  const sc0 = await p.evaluate(() => +getComputedStyle(document.querySelector(".scrim")).opacity);
  ok(sc0 < 0.95 && sc0 > 0.5, `Hintergrund dunkelt proportional ab (Scrim ${sc0.toFixed(2)})`);
  await p.mouse.move(gx, gy - 80, { steps: 8 });
  const yUp = await sheetY();
  ok(yUp < 0 && yUp > -40, `Gummiband nach oben (y=${yUp?.toFixed(1)})`);
  await p.mouse.move(gx, gy + 20, { steps: 8 });
  await p.mouse.up();
  await wait(800);
  ok(Math.abs(await sheetY()) < 2, "Langsames Loslassen: Blatt federt zurück");
  // schneller Wurf nach unten schliesst, auch bei kleinem Weg
  const g2 = await p.locator(".grab").boundingBox();
  await p.mouse.move(g2.x + 100, g2.y + 10); await p.mouse.down();
  for (let i = 1; i <= 5; i++) { await p.mouse.move(g2.x + 100, g2.y + 10 + i * 14); await wait(8); }
  await p.mouse.up();
  await wait(800);
  ok((await p.locator(".sheet").count()) === 0, "Schneller Wurf schliesst das Blatt (Schwung entscheidet)");
  // wieder öffnen, am Inhalt ziehen (Inhalt ganz oben)
  await hero.click(); await p.waitForSelector(".sheet"); await wait(700);
  const body = await p.locator(".sh").boundingBox();
  await p.mouse.move(body.x + 150, body.y + 120); await p.mouse.down();
  await p.mouse.move(body.x + 150, body.y + 200, { steps: 8 });
  ok((await sheetY()) > 40, `Auch am Inhalt ziehbar (y=${(await sheetY())?.toFixed(0)})`);
  await p.mouse.move(body.x + 150, body.y + 120, { steps: 6 });
  await p.mouse.up(); await wait(700);
  // Umkehren während des Schliessens: Wurf, dann sofort greifen
  const g3 = await p.locator(".grab").boundingBox();
  await p.mouse.move(g3.x + 100, g3.y + 10); await p.mouse.down();
  for (let i = 1; i <= 5; i++) { await p.mouse.move(g3.x + 100, g3.y + 10 + i * 14); await wait(8); }
  await p.mouse.up();
  await wait(120);
  const yClosing = await sheetY();
  // Greifen während des Schliessens: Ereignisse direkt im Browser erzeugen, damit keine Testlatenz dazwischenkommt.
  await p.evaluate(async () => {
    const sheet = document.querySelector(".sheet");
    const r = sheet.getBoundingClientRect();
    const x = r.left + 100;
    let y = r.top + 20;
    const ev = (type, yy) => sheet.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: yy }));
    ev("pointerdown", y);
    for (let i = 0; i < 12; i++) { y -= 30; ev("pointermove", y); await new Promise((r) => setTimeout(r, 12)); }
    ev("pointerup", y);
  });
  await wait(900);
  ok(yClosing > 0 && (await p.locator(".sheet").count()) === 1 && Math.abs(await sheetY()) < 2, `Blatt jederzeit greifbar und umkehrbar (beim Schliessen y=${yClosing?.toFixed(0)})`);
  await closeSheet();
  ok((await p.locator(".sheet").count()) === 0, "Escape schliesst das Blatt");

  /* ---- Aufgabe-Blatt ---- */
  await p.locator(".slot", { hasText: "Franz lernen" }).first().click();
  await p.waitForSelector(".sheet"); await wait(700);
  await shot("11-blatt-aufgabe");
  await p.locator("input[placeholder='Unteraufgabe hinzufügen']").fill("Vokabeln");
  await p.locator("input[placeholder='Unteraufgabe hinzufügen']").press("Enter");
  await wait(400);
  ok((await p.locator(".sheet .slot").count()) === 1, "Unteraufgabe erscheint sofort");
  await tapTargets("Aufgaben-Blatt");
  await p.locator("button", { hasText: "Auf morgen" }).click();
  await wait(700);
  await p.locator("button", { hasText: /^Löschen$/ }).click();
  await shot("12-blatt-aufgabe-loeschen");
  await p.locator("button", { hasText: "Wirklich löschen" }).click();
  await wait(900);
  ok((await p.locator(".sheet").count()) === 0, "Aufgabe gelöscht, Blatt geschlossen");

  /* ---- Gym: Training heute (Plan Oberkörper am Samstag) ---- */
  await go("/");
  await p.locator(".slot", { hasText: "Gym" }).click();
  await p.waitForSelector(".sheet"); await wait(1200);
  await shot("13-blatt-training");
  ok((await p.locator(".exset").count()) === 6, "Training heute: 6 Sätze aus dem Plan");
  await p.locator(".exset .chkhit").first().click();
  await p.locator(".exset input").first().fill("45");
  await p.locator(".exset input").first().press("Enter");
  await wait(500);
  ok((await p.locator(".exset.done").count()) === 1, "Satz abgehakt");
  await p.locator(".cta", { hasText: "Training abschliessen" }).click();
  await wait(600);
  await closeSheet();
  ok((await p.locator(".gym button.g").count()) === 1, "Abgeschlossenes Training steht im Raster");
  // Rückmeldung 2. Mal: Gewicht bleibt und Verlauf
  await p.locator(".gym button").nth((await p.locator(".gym button").count()) - 2).click();
  await p.waitForSelector(".sheet"); await wait(800);
  await shot("14-blatt-training-vergangen");
  await closeSheet();
  await shot("15-heute-mit-training", true);
  await tapTargets("Heute");

  /* ---- Prüfung ---- */
  await p.locator(".ex").first().click();
  await p.waitForSelector(".sheet"); await wait(700);
  await p.locator(".tp").first().locator("button[data-k='1']").click();
  await p.locator(".tp").nth(1).locator("button[data-k='2']").click();
  await shot("16-blatt-pruefung");
  await p.locator(".cta", { hasText: "Lernblöcke einplanen" }).click();
  await wait(900);
  const planned = await p.evaluate(async () => (await (await fetch("/api/tasks")).json()).filter((t) => t.examId).length);
  ok(planned === 1, `Lernblöcke eingeplant (${planned}, nur nicht-sitzende Themen)`);
  await shot("17-blatt-pruefung-eingeplant");
  await closeSheet();

  /* ---- Ziele, Noten ---- */
  await post(p, "/grades", { subjectCode: "FRW", value: 3.5, date: "2026-11-01" });
  await go("/ziele");
  await shot("18-ziele", true);
  await overflow("Ziele");
  await p.locator(".gr", { hasText: "W+R" }).click();
  await p.waitForSelector(".sheet"); await wait(700);
  await p.locator("#g-v").fill("5.5");
  await p.locator("button.cta", { hasText: "Hinzufügen" }).click();
  await p.locator("#g-v").fill("3.5");
  await p.locator("#g-w").fill("2");
  await p.locator("button.cta", { hasText: "Hinzufügen" }).click();
  await wait(600);
  await shot("19-blatt-fach");
  ok((await p.locator(".sheet .yh b").first().innerText()).includes("4,17") || (await p.locator(".sheet .yh b").first().innerText()).includes("4.17"), "Fachschnitt gewichtet (4.17)");
  await p.locator("#r-t").fill("4.5");
  const need = await p.locator(".sheet .yh").last().innerText();
  ok(/5[,.]/.test(need), `Rechner: ${need.replace(/\n/g, " ")}`);
  await closeSheet();
  ok((await p.locator(".gr.bad").count()) === 1, "Fach unter 4 ist rot");
  await tapTargets("Ziele");

  /* ---- Zeit, Einstellungen ---- */
  await go("/zeit");
  await shot("20-zeit-ohne-geburtsdatum", true);
  await post(p, "/settings", { birthDate: "2011-05-10" }, "PUT");
  await go("/zeit");
  await shot("21-zeit", true);
  await overflow("Zeit"); await tapTargets("Zeit");
  await go("/einstellungen");
  await shot("22-einstellungen", true);
  await overflow("Einstellungen"); await tapTargets("Einstellungen");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("button", { hasText: "Daten exportieren" }).click()]);
  ok(/dashboard-.*\.json/.test(dl.suggestedFilename()), "Export als JSON-Datei");

  /* ---- Geld ohne Daten ---- */
  await go("/geld");
  await shot("23-geld-leer", true);
  await overflow("Geld leer");
  await p.locator(".tile, .act", { hasText: "Depot" }).first().click();
  await p.waitForSelector(".sheet"); await wait(700);
  await shot("24-blatt-depot-leer");
  await closeSheet();
  await go("/koerper");
  await shot("25-koerper-leer", true);
  await p.locator(".stat", { hasText: "Schlaf" }).click();
  await p.waitForSelector(".sheet"); await wait(700);
  await shot("26-blatt-schlaf-leer");
  await closeSheet();
  await p.locator(".stat", { hasText: "Gewicht" }).click();
  await p.waitForSelector(".sheet"); await wait(600);
  await p.locator("#kg").fill("68.4");
  await p.locator(".cta", { hasText: "Eintragen" }).click();
  await wait(700);
  await shot("27-blatt-gewicht");
  await closeSheet();

  /* ---- Geld und Körper mit Daten (nur lokale Testdaten) ---- */
  const today = await p.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()));
  const d = (n) => { const t = new Date(today + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };
  const cats = await p.evaluate(async () => Object.fromEntries((await (await fetch("/api/categories")).json()).map((c) => [c.name, c.id])));
  const accs = await p.evaluate(async () => (await (await fetch("/api/accounts")).json()));
  const A = accs[0].id;
  const txs = [
    [4, -18.4, "Essen auswärts", "Mittag Migros Restaurant"], [6, -22.9, "Essen auswärts", "Abendessen Pizzeria"], [3, -4.2, "Snack", "Gipfeli"],
    [9, -12.5, "Lebensmittel", "Coop"], [11, -2.8, "Transport", "ZVV Billett"], [12, -15, "Unterhaltung", "Kino"], [13, -7.2, "Sonstiges", "Apotheke"],
  ];
  for (const [n, amount, cat, description] of txs) await post(p, "/transactions", { accountId: A, categoryId: cats[cat], date: d(n), amount, description });
  await post(p, "/transactions", { accountId: A, date: d(1), amount: 20, description: "Twint Mama", isRepayment: true });
  await post(p, "/invest", { kind: "value", date: d(60), amount: 1050 });
  await post(p, "/invest", { kind: "value", date: d(30), amount: 1390 });
  await post(p, "/invest", { kind: "value", date: d(2), amount: 1740 });
  await post(p, "/settings", { investStart: "2026-09-01" }, "PUT");
  for (let i = 0; i < 40; i++) await post(p, `/health/${d(i)}`, { sleepMin: 380 + ((i * 37) % 110), steps: 3000 + ((i * 911) % 9000), restingHr: 56 + (i % 7), weightKg: 68 + ((i % 9) - 4) / 10, source: "fitbit" }, "PUT");
  await go("/");
  await shot("28-heute-mit-daten", true);
  await go("/geld");
  await shot("29-geld", true);
  await overflow("Geld"); await tapTargets("Geld");
  await p.locator(".card.tap", { hasText: "Offen von Mama" }).click();
  await p.waitForSelector(".sheet"); await wait(700);
  await shot("30-blatt-mama");
  const openText = await p.locator(".sheet .bigv, .sheet .money-n").first().innerText();
  ok(openText.replace(/\s/g, "").includes("0.65") || openText.replace(/\s/g, "").includes("0.65".replace(".", ".")) || /\.65/.test(openText), `Offen von Mama 20.65 minus 20 Twint = .65: ${openText.replace(/\n/g, " ")}`);
  await p.locator("button", { hasText: "Beglichen" }).first().click();
  await wait(500);
  await shot("31-blatt-mama-beglichen");
  await closeSheet();
  await p.locator(".card.tap", { hasText: "Depot" }).click();
  await p.waitForSelector(".sheet"); await wait(700);
  await shot("32-blatt-depot");
  await closeSheet();
  await p.locator(".lrow").first().click();
  await p.waitForSelector(".sheet"); await wait(600);
  await shot("33-blatt-buchung");
  await closeSheet();
  /* ---- Bank-Import ---- */
  const REV = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-11-06 12:30:00,2026-11-06 12:30:00,Pizzeria Roma,-26.00,0.00,CHF,COMPLETED,\nCARD_PAYMENT,Current,2026-11-07 10:00:00,2026-11-07 10:00:00,Migros Bahnhof,-14.30,0.00,CHF,COMPLETED,\nTOPUP,Current,2026-11-08 09:00:00,2026-11-08 09:00:00,Aufladung,100.00,0.00,CHF,COMPLETED,\n";
  const ZK = "Kontoauszug;Test\nIBAN;CH00 0000 0000 0000 0000 0\n\nDatum;Buchungstext;Belastung CHF;Gutschrift CHF;Valuta;Saldo CHF\n08.11.2026;Überweisung Revolut;100.00;;08.11.2026;900.00\n";
  await go("/geld");
  await p.locator("label.act input[type=file]").setInputFiles([{ name: "revolut.csv", mimeType: "text/csv", buffer: Buffer.from(REV) }, { name: "zkb-export.csv", mimeType: "text/csv", buffer: Buffer.from(ZK) }]);
  await p.waitForSelector(".sheet .yh b"); await wait(900);
  await shot("34-blatt-import-vorschau");
  ok((await p.locator(".sheet .yh b").first().innerText()) === "4", "Import-Vorschau zeigt 4 neue Buchungen");
  await p.locator(".sheet .cta", { hasText: "speichern" }).click();
  await p.waitForSelector(".sheet h3:has-text('Gespeichert')"); await wait(500);
  await shot("35-blatt-import-gespeichert");
  await p.locator(".sheet .cta", { hasText: "Fertig" }).click(); await wait(700);
  await p.locator("label.act input[type=file]").setInputFiles([{ name: "revolut.csv", mimeType: "text/csv", buffer: Buffer.from(REV) }]);
  await p.waitForSelector(".sheet .yh b"); await wait(900);
  ok((await p.locator(".sheet .cta").first().innerText()).includes("Nichts Neues"), "Zweiter Upload derselben Datei: alles schon vorhanden");
  await closeSheet();
  await p.locator("label.act input[type=file]").setInputFiles([{ name: "komisch.csv", mimeType: "text/csv", buffer: Buffer.from("Foo;Bar;Baz\n2026-11-01;Kaffee;-3.50\n") }]);
  await p.waitForSelector(".sheet"); await wait(900);
  await shot("36-blatt-import-spalten-unsicher");
  await p.locator(".sheet button", { hasText: "Spalten zuordnen" }).click(); await wait(400);
  await shot("37-blatt-import-zuordnung");
  await closeSheet();
  await go("/geld");
  await shot("38-geld-nach-import", true);
  await go("/analyse");
  await shot("34-analyse", true);
  await overflow("Analyse");
  await go("/");
  await p.locator(".tile", { hasText: "Übrig" }).click();
  await p.waitForSelector(".sheet"); await wait(800);
  await shot("39-blatt-uebrig");
  await closeSheet();
  await p.locator(".tile", { hasText: "Schlaf" }).click();
  await p.waitForSelector(".sheet"); await wait(800);
  await shot("40-blatt-schlaf");
  await p.locator(".seg button", { hasText: "30" }).click(); await wait(500);
  await shot("41-blatt-schlaf-30");
  await closeSheet();
  await go("/koerper");
  await shot("42-koerper", true);
  await overflow("Körper"); await tapTargets("Körper");

  console.log("Konsolenfehler:", errors.length, errors.slice(0, 5));
  ok(errors.length === 0, "keine Konsolenfehler");

  /* ---- reduzierte Bewegung ---- */
  const c2 = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
  const q = await c2.newPage();
  await q.goto(BASE + "/"); await q.waitForSelector(".hero"); await q.locator(".hero").click(); await q.waitForSelector(".sheet"); await wait(500);
  const rm = await q.evaluate(() => { const s = document.querySelector(".sheet"); const m = new DOMMatrix(getComputedStyle(s).transform); return [m.m42, +getComputedStyle(s).opacity]; });
  ok(Math.abs(rm[0]) < 1 && rm[1] > 0.95, `Reduzierte Bewegung: Blatt überblendet statt zu gleiten (y=${rm[0]}, opacity=${rm[1]})`);
  await browser.close();
  console.log(failures ? `\n${failures} Fehler` : "\nAlles ok");
  process.exit(failures ? 1 : 0);
})();
