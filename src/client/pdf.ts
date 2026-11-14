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
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const items: PdfItem[] = [];
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ page: p, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, w: it.width, text: it.str });
      }
    }
    const lines = groupLines(items);
    const res = parsePdf(lines);
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
    void task.destroy();
  }
}
