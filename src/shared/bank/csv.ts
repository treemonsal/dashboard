// CSV-Leser: Trennzeichen automatisch, Anführungszeichen, BOM, CRLF.

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (c === delimiter) endCell();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") endRow();
    else cell += c;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

const CANDIDATES = [";", ",", "\t", "|"];

/** Wählt das Trennzeichen, das die meisten Zeilen mit gleicher, mehrspaltiger Struktur ergibt. */
export function detectDelimiter(text: string): string {
  let best = ",";
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const rows = parseDelimited(text, d);
    const freq = new Map<number, number>();
    for (const r of rows) if (r.length >= 2) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    let modal = 0;
    let modalRows = 0;
    for (const [len, n] of freq) if (n > modalRows || (n === modalRows && len > modal)) [modal, modalRows] = [len, n];
    const score = modalRows * (modal - 1);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function readCsv(text: string, delimiter?: string): { table: string[][]; delimiter: string } {
  const t = stripBom(text);
  const d = delimiter ?? detectDelimiter(t);
  return { table: parseDelimited(t, d), delimiter: d };
}
