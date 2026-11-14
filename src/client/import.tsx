// Bank-Export hochladen: Dateien wählen, Vorschau (neu, schon vorhanden, Warnungen), bei unsicheren Spalten Zuordnung bestätigen, speichern.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ImportFileIn } from "./api";
import { dayCompact } from "../shared/dates";
import type { ImportFilePreview, ImportPreview, ImportResult } from "../shared/schemas";
import { useSheet } from "./sheet";
import { Icon, Money } from "./ui";
import { notify } from "./toast";

const BANK: Record<string, string> = { revolut: "Revolut", zkb: "ZKB", yuh: "Yuh", unbekannt: "Bank nicht erkannt" };

async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf); // ältere Bank-Exporte
  }
}

/** Runde Aktion "Export hochladen": öffnet die Dateiauswahl (auch mehrere) und danach das Blatt mit der Vorschau. */
export function UploadAction() {
  const sheet = useSheet();
  const input = useRef<HTMLInputElement>(null);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!list.length) return;
    try {
      const files: ImportFileIn[] = [];
      for (const f of list) files.push({ name: f.name, text: await readText(f) });
      sheet.open(<ImportSheet initial={files} />);
    } catch {
      notify("Datei konnte nicht gelesen werden");
    }
  }
  return (
    <label className="act press" style={{ cursor: "pointer", position: "relative" }}>
      <i>
        <Icon n="upload" />
      </i>
      Export
      <input ref={input} type="file" multiple accept=".csv,.txt,text/csv,text/plain,application/vnd.ms-excel" onChange={pick} aria-label="Bank-Export hochladen"
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
    </label>
  );
}

function headerOf(file: ImportFileIn, p: ImportFilePreview): string[] {
  if (p.header) return p.header;
  const lines = file.text.split(/\r?\n/);
  const hr = p.mapping?.headerRow ?? 0;
  const sep = p.mapping?.delimiter ?? (lines[hr]?.includes(";") ? ";" : ",");
  return (lines[hr] ?? "").split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
}

const FIELDS: [keyof NonNullable<ImportFilePreview["mapping"]>, string][] = [
  ["date", "Datum"],
  ["description", "Text"],
  ["amount", "Betrag"],
  ["debit", "Belastung"],
  ["credit", "Gutschrift"],
  ["currency", "Währung"],
];

function MapStep({ file, preview, onDone, onBack }: { file: ImportFileIn; preview: ImportFilePreview; onDone: (m: NonNullable<ImportFileIn["mapping"]>) => void; onBack: () => void }) {
  const header = headerOf(file, preview);
  const init = (preview.mapping ?? {}) as Record<string, number | number[] | string | undefined>;
  const [m, setM] = useState<Record<string, number | undefined>>(() => {
    const o: Record<string, number | undefined> = {};
    for (const [k] of FIELDS) {
      const v = init[k as string];
      o[k as string] = Array.isArray(v) ? v[0] : typeof v === "number" ? v : undefined;
    }
    return o;
  });
  const ok = m.date !== undefined && m.description !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined);
  return (
    <div>
      <h3>Spalten zuordnen</h3>
      <div className="when">{file.name}</div>
      {FIELDS.map(([k, label]) => (
        <div key={k} className="field">
          <label htmlFor={`m-${k}`}>{label}</label>
          <select id={`m-${k}`} className="inp" value={m[k] ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">Keine</option>
            {header.map((h, i) => (
              <option key={i} value={i}>{h || `Spalte ${i + 1}`}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" className="cta press" disabled={!ok} onClick={() => onDone({ ...(preview.mapping ?? {}), ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) } as NonNullable<ImportFileIn["mapping"]>)}>Übernehmen</button>
      <button type="button" className="cta ghost press" onClick={onBack}>Zurück</button>
    </div>
  );
}

export function ImportSheet({ initial }: { initial: ImportFileIn[] }) {
  const sheet = useSheet();
  const qc = useQueryClient();
  const [files, setFiles] = useState(initial);
  const [pre, setPre] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [mapIdx, setMapIdx] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setPre(null);
    setErr(null);
    api.bank.preview(files).then((p) => live && setPre(p)).catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [files]);

  async function save() {
    setBusy(true);
    try {
      const r = await api.bank.commit(files);
      setRes(r);
      for (const k of [["tx"], ["accounts"], ["categories"]]) qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (res) {
    return (
      <div>
        <h3>Gespeichert</h3>
        <div className="when">{res.duplicates} schon vorhanden, übersprungen</div>
        <div className="yh"><b>{res.inserted}</b><span>neue Buchungen</span></div>
        <button type="button" className="cta press" onClick={() => sheet.close()}>Fertig</button>
      </div>
    );
  }
  if (mapIdx !== null && pre?.files[mapIdx]) {
    return (
      <MapStep file={files[mapIdx]!} preview={pre.files[mapIdx]!} onBack={() => setMapIdx(null)}
        onDone={(mapping) => { setFiles(files.map((f, i) => (i === mapIdx ? { ...f, mapping } : f))); setMapIdx(null); }} />
    );
  }
  return (
    <div>
      <h3>Export</h3>
      <div className="when">{files.length === 1 ? files[0]!.name : `${files.length} Dateien`}</div>
      {err && <div className="bad" style={{ marginBottom: 10 }}>{err}</div>}
      {pre && (
        <>
          <div className="yh"><b>{pre.fresh}</b><span>neu · {pre.duplicates} schon vorhanden</span></div>
          {pre.files.map((p, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</b>
                  <span className="muted" style={{ fontSize: 13 }}>{BANK[p.bank] ?? p.bank}{p.needsConfirmation ? "" : ` · ${p.fresh} neu · ${p.duplicates} schon vorhanden`}</span>
                </div>
                {p.needsConfirmation && <button type="button" className="chip btn press" onClick={() => setMapIdx(i)}>Spalten zuordnen</button>}
              </div>
              {p.warnings.map((w, j) => (<div key={j} className="warn" style={{ fontSize: 13, marginTop: 4 }}>{w}</div>))}
              {p.sample.map((s, j) => (
                <div key={j} className="row" style={{ minHeight: 40 }}>
                  <div className="l"><b style={{ fontWeight: 500, fontSize: 14 }}>{s.description}</b><span>{dayCompact(s.date)} · {s.category}</span></div>
                  <span className="r"><Money v={s.amountChf / 100} size={15} cur={false} signed /></span>
                </div>
              ))}
            </div>
          ))}
          <button type="button" className="cta press" disabled={busy || pre.fresh === 0} onClick={save}>
            {pre.fresh === 0 ? "Nichts Neues" : `${pre.fresh} Buchungen speichern`}
          </button>
        </>
      )}
    </div>
  );
}
