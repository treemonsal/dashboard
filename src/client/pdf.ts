// PDF-Kontoauszug im Browser lesen. Das PDF verlässt das Gerät nicht: pdf.js läuft hier, nur die erkannten Buchungen gehen an den Server.
// pdf.js und seine Worker-Datei werden erst beim ersten PDF nachgeladen (dynamischer Import) und von der eigenen Adresse ausgeliefert.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { groupLines, parsePdf, pdfText, type PdfItem } from "../shared/bank/pdf";
import type { ImportFileIn } from "./api";

const MAX_BYTES = 20_000_000;
const MAX_PAGES = 80;

export async function readPdfFile(file: File): Promise<ImportFileIn> {
  if (file.size > MAX_BYTES) throw new Error("PDF zu gross");
  const pdfjs = await import("pdfjs-dist");
  // Alte Auslieferungen wurden mit falschem MIME Typ ein Jahr lang gecacht.
  // Die neue URL holt einmalig die korrigierte Modulantwort, auch auf bestehenden iPhones.
  pdfjs.GlobalWorkerOptions.workerSrc = `${workerUrl}?module=1`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) throw new Error("PDF zu lang");
    const items: PdfItem[] = [];
    const n = doc.numPages;
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ page: p, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, w: it.width, text: it.str });
      }
    }
    if (!items.length) throw new Error("PDF ohne Text");
    const lines = groupLines(items);
    const res = parsePdf(lines, { fileName: file.name });
    return {
      name: file.name,
      text: "",
      pdf: {
        bank: res.bank,
        ...(res.account ? { account: res.account } : {}),
        uncertain: res.uncertain ?? 0,
        confirmed: false,
        rows: res.rows.map(({ date, description, amount, currency, amountChf, balance, chfEstimated }) => ({
          date, description, amount, currency, amountChf, ...(balance !== undefined ? { balance } : {}), ...(chfEstimated ? { chfEstimated } : {}),
        })),
      },
      pdfInfo: { warnings: res.warnings, dated: res.stats.dated, recognized: res.stats.recognized, text: pdfText(lines) },
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
