// Erzeugt die PNG-Icons aus public/icons/icon.svg (einmalig, Ergebnis liegt im Repo).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "../public/icons/icon.svg"), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["icon-maskable-512.png", 512, 0], ["apple-touch-icon.png", 1024, 0]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(__dirname, "../public/icons", name) });
  }
  await browser.close();
})();
