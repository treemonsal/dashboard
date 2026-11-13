import type { Buchung } from "./types";

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashString(s: string): string {
  return cyrb53(s, 0).toString(16).padStart(14, "0") + cyrb53(s, 7).toString(16).padStart(14, "0");
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Setzt row.hash aus Konto, Datum, Betrag, Währung, Text und laufender Nummer gleicher Buchungen
 * am selben Tag (Reihenfolge wie in der Datei). Zwei echte gleiche Buchungen bleiben so beide erhalten,
 * ein zweiter Upload derselben Datei ergibt dieselben Hashes.
 */
export function assignHashes(rows: Buchung[], account: string): void {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = [account, r.date, r.amount, r.currency, normText(r.description)].join("|");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    r.hash = hashString(`${key}|${n}`);
  }
}

/** Trennt bereits bekannte Buchungen (Hash vorhanden) von neuen. */
export function dedupe(existingHashes: Iterable<string>, rows: Buchung[]): { fresh: Buchung[]; duplicates: Buchung[] } {
  const known = new Set(existingHashes);
  const fresh: Buchung[] = [];
  const duplicates: Buchung[] = [];
  for (const r of rows) {
    if (known.has(r.hash)) duplicates.push(r);
    else {
      known.add(r.hash);
      fresh.push(r);
    }
  }
  return { fresh, duplicates };
}
