// Geld: Ausgaben, Buchungen, Konten, Depot, offene Rückzahlungen der Mutter.
import { useMemo, useState } from "react";
import { addDays, dayCompact, daysBetween, monthLong, todayInZone } from "../shared/dates";
import { byCategory, depositTotal, mamaBalance, ownShare } from "../shared/geld";
import type { Category, InvestmentEntry, Transaction } from "../shared/schemas";
import { useSheet } from "./sheet";
import { notify } from "./toast";
import { Icon, Money, nf } from "./ui";
import { useAddInvest, useAllTransactions, useCategories, useInvest, useRemoveInvest, useSetSetting, useSettings, useToday, useUpdateTx } from "./queries";

const uid = () => crypto.randomUUID();
const CAT: Record<string, { icon: string }> = {
  Lebensmittel: { icon: "cart" },
  Transport: { icon: "car" },
  "Essen auswärts": { icon: "fork" },
  Snack: { icon: "fork" },
  Unterhaltung: { icon: "film" },
  Gastronomie: { icon: "fork" },
  "Sparen/Anlage": { icon: "coin" },
  Einkommen: { icon: "up" },
  Sonstiges: { icon: "dots" },
};
export function CatIcon({ name }: { name?: string | null }) {
  const c = CAT[name ?? ""] ?? CAT.Sonstiges;
  return (
    <span className="ic">
      <Icon n={c.icon} />
    </span>
  );
}

export const monthTitle = (month: string) => monthLong(Number(month.slice(5, 7)));

/** Kumulierte eigene Ausgaben über den Monat, ab heute gestrichelt hochgerechnet, mit Budgetlinie. */
export function SpendChart({ txs, month, budget, today }: { txs: Transaction[]; month: string; budget: number; today: string }) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isNow = today.startsWith(month);
  const upto = isNow ? Number(today.slice(8, 10)) : days;
  const per = Array.from({ length: days }, () => 0);
  for (const t of txs) per[Number(t.date.slice(8, 10)) - 1] += ownShare(t);
  const cum: number[] = [];
  per.reduce((s, v, i) => ((cum[i] = s + v), s + v), 0);
  const spent = cum[upto - 1] ?? 0;
  const proj = isNow && upto > 0 ? (spent / upto) * days : spent;
  const top = Math.max(budget, proj, spent, 1) * 1.15;
  const W = 300, Hh = 130;
  const X = (d: number) => (d / days) * W;
  const Y = (v: number) => Hh - (v / top) * (Hh - 6);
  const pts = Array.from({ length: upto }, (_, i) => [X(i + 1), Y(cum[i])] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  const area = pts.length ? `${line}L${pts.at(-1)![0].toFixed(1)} ${Hh}L${pts[0][0].toFixed(1)} ${Hh}Z` : "";
  return (
    <div>
      <svg className="area" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label="Verlauf der Ausgaben im Monat">
        <line className="bl" x1="0" x2={W} y1={Y(budget)} y2={Y(budget)} />
        {area && <path className="fl" d={area} />}
        {line && <path className="ln" d={line} vectorEffect="non-scaling-stroke" />}
        {isNow && upto < days && pts.length > 0 && <path className="pj" d={`M${pts.at(-1)![0]} ${pts.at(-1)![1]}L${W} ${Y(proj)}`} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="sub" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--fg2)", paddingTop: 6 }}>
        <span>Budget {nf(budget)}</span>
        {isNow && upto < days && <span>erwartet {nf(proj)}</span>}
      </div>
    </div>
  );
}

export function TxRow({ t, cats }: { t: Transaction; cats: Category[] }) {
  const sheet = useSheet();
  const c = cats.find((x) => x.id === t.categoryId);
  return (
    <button type="button" className="lrow press" onClick={() => sheet.open(<TxSheet id={t.id} />)}>
      <CatIcon name={t.isRepayment ? "Sonstiges" : c?.name} />
      <span className="w">
        <b>{t.description || c?.name || (t.isRepayment ? "Rückzahlung" : "Buchung")}</b>
        <span>{dayCompact(t.date)}{c ? ` · ${c.name}` : ""}{t.mealOut ? " · Mahlzeit" : ""}{t.isRepayment ? " · Rückzahlung" : ""}{t.internal ? " · eigene Überweisung" : ""}{t.currency !== "CHF" ? ` · ${t.currency}` : ""}</span>
      </span>
      <span className="a"><Money v={t.amount} size={17} cur={false} signed /></span>
    </button>
  );
}

export function TxSheet({ id }: { id: string }) {
  const tx = useAllTransactions().data ?? [];
  const cats = useCategories().data ?? [];
  const upd = useUpdateTx();
  const t = tx.find((x) => x.id === id);
  if (!t) return <div style={{ minHeight: 120 }} />;
  const set = (patch: Record<string, unknown>) => upd.mutate({ id, patch });
  return (
    <div>
      <h3>{t.description || "Buchung"}</h3>
      <div className="when"><Money v={t.amount} size={26} signed /> · {dayCompact(t.date)}</div>
      <div className="field">
        <label htmlFor="tx-c">Kategorie</label>
        <select id="tx-c" className="inp" value={t.categoryId ?? ""} onChange={(e) => { set({ categoryId: e.target.value || null }); if (e.target.value && t.description) notify("Gemerkt für ähnliche Buchungen"); }}>
          <option value="">Keine</option>
          {cats.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </div>
      {t.amount < 0 && (
        <div className="field">
          <span>Mahlzeit auswärts</span>
          <button type="button" className="seg press" aria-pressed={t.mealOut} onClick={() => set({ mealOut: !t.mealOut })}>
            <span style={{ padding: "0 14px", height: 40, display: "grid", placeItems: "center", borderRadius: 9, background: t.mealOut ? "var(--fg)" : "transparent", color: t.mealOut ? "#000" : "var(--fg3)", fontWeight: 600 }}>{t.mealOut ? "Ja" : "Nein"}</span>
          </button>
        </div>
      )}
      {t.amount > 0 && (
        <div className="field">
          <span>Rückzahlung von Mama</span>
          <button type="button" className="seg press" aria-pressed={t.isRepayment} onClick={() => set({ isRepayment: !t.isRepayment })}>
            <span style={{ padding: "0 14px", height: 40, display: "grid", placeItems: "center", borderRadius: 9, background: t.isRepayment ? "var(--fg)" : "transparent", color: t.isRepayment ? "#000" : "var(--fg3)", fontWeight: 600 }}>{t.isRepayment ? "Ja" : "Nein"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function useMama() {
  const all = useAllTransactions().data ?? [];
  const bal = useMemo(() => mamaBalance(all), [all]);
  return { all, ...bal, any: all.some((t) => t.mealOut) };
}

export function MamaSheet() {
  const m = useMama();
  const upd = useUpdateTx();
  const name = useSettings().mamaName;
  const open = m.meals.filter((x) => x.status !== "settled").reverse();
  const done = m.meals.filter((x) => x.status === "settled").reverse();
  const Row = ({ x }: { x: (typeof m.meals)[number] }) => (
    <div className="lrow" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
      <span className="w">
        <b>{x.tx.description || "Mahlzeit"}</b>
        <span>{dayCompact(x.tx.date)}{x.status === "partial" ? ` · ${nf(x.covered, 2)} erhalten` : ""}</span>
      </span>
      <span className="a"><Money v={x.expected} size={17} cur={false} /></span>
      <button type="button" className="chip btn press" onClick={() => upd.mutate({ id: x.tx.id, patch: { settled: !x.tx.settledAt } })}>
        {x.tx.settledAt ? "Öffnen" : "Beglichen"}
      </button>
    </div>
  );
  return (
    <div>
      <h3>Offen von Mama</h3>
      <div className="when">{name ? name : "Hälfte der Mahlzeiten auswärts"}</div>
      <div style={{ marginBottom: 6 }}><Money v={m.open} size={38} /></div>
      {m.meals.length === 0 && <div className="empty">Noch keine Mahlzeit auswärts.</div>}
      {open.map((x) => (<Row key={x.tx.id} x={x} />))}
      {done.length > 0 && <div className="sec">Beglichen</div>}
      {done.map((x) => (<Row key={x.tx.id} x={x} />))}
    </div>
  );
}

/* ---------- Depot ---------- */
export function useDepot() {
  const entries = useInvest().data ?? [];
  const s = useSettings();
  const today = useToday();
  const values = entries.filter((e) => e.kind === "value");
  const latest = values.at(-1) ?? null;
  const extra = entries.filter((e) => e.kind === "deposit").reduce((a, e) => a + e.amount, 0);
  const deposits = depositTotal({ monthly: Number(s.investMonthly), start: s.investStart, today, extra });
  return { entries, values, latest, deposits, gain: latest ? latest.amount - deposits : null, hasDeposits: deposits > 0 };
}

export function ValueLine({ values }: { values: InvestmentEntry[] }) {
  if (values.length < 2) return null;
  const W = 300, H = 120;
  const min = Math.min(...values.map((v) => v.amount)), max = Math.max(...values.map((v) => v.amount));
  const span = max - min || 1;
  const t0 = Date.parse(values[0].date), t1 = Date.parse(values.at(-1)!.date) || t0 + 1;
  const pts = values.map((v) => [((Date.parse(v.date) - t0) / (t1 - t0 || 1)) * W, H - 8 - ((v.amount - min) / span) * (H - 16)] as const);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Verlauf des Depotwerts">
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DepotSheet() {
  const d = useDepot();
  const s = useSettings();
  const setS = useSetSetting();
  const add = useAddInvest();
  const rem = useRemoveInvest();
  const today = useToday();
  const [val, setVal] = useState("");
  const [vd, setVd] = useState(today);
  const [dep, setDep] = useState("");
  const parse = (x: string) => { const n = parseFloat(x.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; };
  return (
    <div>
      <h3>Depot S&amp;P 500</h3>
      <div className="when">{d.latest ? `Stand ${dayCompact(d.latest.date)}` : "Noch kein Wert eingetragen"}</div>
      {d.latest ? <Money v={d.latest.amount} size={38} /> : <div className="bigv faint">–</div>}
      <ValueLine values={d.values} />
      <div className="row"><div className="l"><b>Einzahlungen</b></div><span className="r"><Money v={d.deposits} size={17} cur={false} /></span></div>
      <div className="row"><div className="l"><b>Gewinn / Verlust</b></div>
        <span className={`r ${d.gain === null ? "" : d.gain >= 0 ? "good" : "bad"}`}>{d.gain === null ? "–" : <Money v={d.gain} size={17} cur={false} signed />}</span></div>
      <div className="sec">Wert eintragen</div>
      <div className="field"><label htmlFor="d-v">Betrag</label><input id="d-v" className="inp num" style={{ width: 110 }} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></div>
      <div className="field"><label htmlFor="d-d">Datum</label><input id="d-d" className="inp" type="date" value={vd} onChange={(e) => setVd(e.target.value)} /></div>
      <button type="button" className="cta press" disabled={parse(val) === null || !vd} onClick={() => { add.mutate({ id: uid(), kind: "value", date: vd, amount: parse(val)! }); setVal(""); }}>Wert speichern</button>
      <div className="sec">Einzahlungen</div>
      <div className="field"><label htmlFor="d-s">Erste Einzahlung am</label><input id="d-s" className="inp" type="date" defaultValue={s.investStart} onChange={(e) => setS({ investStart: e.target.value })} /></div>
      <div className="field"><label htmlFor="d-m">Pro Monat</label><input id="d-m" className="inp num" inputMode="decimal" defaultValue={s.investMonthly} onBlur={(e) => { const n = parse(e.target.value); if (n !== null && String(n) !== s.investMonthly) setS({ investMonthly: String(n) }); }} /></div>
      <div className="field"><label htmlFor="d-e">Bisher eingezahlt (einmalig)</label><input id="d-e" className="inp num" style={{ width: 110 }} inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} /></div>
      <button type="button" className="cta ghost press" disabled={parse(dep) === null || !dep} onClick={() => { add.mutate({ id: uid(), kind: "deposit", date: todayInZone(), amount: parse(dep)!, note: "von Hand" }); setDep(""); }}>Einzahlung eintragen</button>
      {d.entries.length > 0 && <div className="sec">Einträge</div>}
      {[...d.entries].reverse().map((e) => (
        <div key={e.id} className="row">
          <div className="l"><b>{e.kind === "value" ? "Wert" : "Einzahlung"} · <Money v={e.amount} size={16} cur={false} /></b><span>{dayCompact(e.date)}</span></div>
          <button type="button" className="iconbtn press" aria-label="Eintrag löschen" onClick={() => rem.mutate(e.id)}><Icon n="trash" /></button>
        </div>
      ))}
    </div>
  );
}

export const _unused = { addDays, daysBetween, byCategory };
