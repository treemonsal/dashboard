// Geld: Ausgaben, Buchungen, Konten, Depot, offene Rückzahlungen der Mutter.
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Link } from "./router";
import { merchantOf } from "../shared/tiefe";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { addDays, dayCompact, daysBetween, monthLong } from "../shared/dates";
import { byCategory, mamaBalance, ownShare } from "../shared/geld";
import { CONFIRMED_HOLDINGS, depotHoldings, PORTFOLIO_PRODUCTS, portfolioProduct, depotRules, depotState, toDepotEntry } from "../shared/depot";
import type { Category, Transaction } from "../shared/schemas";
import { useSheet } from "./sheet";
import { notify } from "./toast";
import { Icon, Money, nf } from "./ui";
import { useAddInvest, useAllTransactions, useInvest, useRemoveInvest, useSetSetting, useSettings, useToday } from "./queries";

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
export function SpendChart({ txs, month, budget, today, dayHref }: { txs: Transaction[]; month: string; budget: number; today: string; dayHref?: (date: string) => string }) {
  const [sel, setSel] = useState<number | null>(null);
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
  const pick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dayHref) return;
    const r = e.currentTarget.getBoundingClientRect();
    const d = Math.max(1, Math.min(upto, Math.round(((e.clientX - r.left) / r.width) * days)));
    setSel(d);
  };
  const selDate = sel ? `${month}-${String(sel).padStart(2, "0")}` : null;
  return (
    <div>
      <div className={dayHref ? "pick press" : undefined} onClick={pick} role={dayHref ? "button" : undefined} aria-label={dayHref ? "Tag im Verlauf wählen" : undefined}>
      <svg className="area" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label="Verlauf der Ausgaben im Monat">
        <line className="bl" x1="0" x2={W} y1={Y(budget)} y2={Y(budget)} />
        {area && <path className="fl" d={area} />}
        {line && <path className="ln" d={line} vectorEffect="non-scaling-stroke" />}
        {isNow && upto < days && pts.length > 0 && <path className="pj" d={`M${pts.at(-1)![0]} ${pts.at(-1)![1]}L${W} ${Y(proj)}`} vectorEffect="non-scaling-stroke" />}
      </svg>
      {sel && <i className="cursor" style={{ left: `${(sel / days) * 100}%` }} />}
      </div>
      {selDate && dayHref && (
        <Link href={dayHref(selDate)} className="daysel press" onClick={() => {}}>
          <span><b>{dayCompact(selDate)}</b> · {nf(per[sel! - 1] ?? 0, 2)}</span>
          <span className="faint">Buchungen <Icon n="chev" className="go" /></span>
        </Link>
      )}
      <div className="sub" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--fg2)", paddingTop: 6 }}>
        <span>Budget {nf(budget)}</span>
        {isNow && upto < days && <span>erwartet {nf(proj)}</span>}
      </div>
    </div>
  );
}

export function TxRow({ t, cats, base = [] }: { t: Transaction; cats: Category[]; base?: string[] }) {
  const sheet = useSheet();
  const c = cats.find((x) => x.id === t.categoryId);
  return (
    <Link href={`/geld/${[...base, "buchung", t.id].join("/")}`} className="lrow press" onClick={() => sheet.close()}>
      <CatIcon name={t.isRepayment ? "Sonstiges" : c?.name} />
      <span className="w">
        <b>{t.description ? merchantOf(t.description).name : c?.name || (t.isRepayment ? "Rückzahlung" : "Buchung")}</b>
        <span>{dayCompact(t.date)}{c ? ` · ${c.name}` : ""}{t.mealOut ? " · Mahlzeit" : ""}{t.isRepayment ? " · Rückzahlung" : ""}{t.internal ? " · eigene Überweisung" : ""}{t.currency !== "CHF" ? ` · ${t.currency}` : ""}</span>
      </span>
      <span className="a"><Money v={t.amount} size={17} cur={false} signed /><Icon n="chev" className="go" /></span>
    </Link>
  );
}

export function useMama() {
  const all = useAllTransactions().data ?? [];
  const bal = useMemo(() => mamaBalance(all), [all]);
  return { all, ...bal, any: all.some((t) => t.mealOut) };
}

/* ---------- Depot ---------- */
export function useDepot() {
  const query = useInvest();
  const entries = query.data ?? [];
  const s = useSettings();
  return useMemo(() => {
    const st = depotState(entries.map((e) => toDepotEntry(e)), depotRules(s));
    const latest = st.latest ? { ...st.latest, amount: st.latest.value } : null;
    return { error: query.error, loading: query.isPending, entries, st, series: st.series, latest, deposits: st.deposited, gain: st.gain, pct: st.pct, hasDeposits: st.deposited > 0 };
  }, [entries, s, query.error, query.isPending]);
}

export const pctText = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${nf(Math.abs(p), 1)} %`;

export function ValueLine({ values }: { values: { date: string; value: number }[] }) {
  if (values.length < 2) return null;
  const W = 300, H = 120;
  const min = Math.min(...values.map((v) => v.value)), max = Math.max(...values.map((v) => v.value));
  const span = max - min || 1;
  const t0 = Date.parse(values[0]!.date), t1 = Date.parse(values.at(-1)!.date) || t0 + 1;
  const pts = values.map((v) => [((Date.parse(v.date) - t0) / (t1 - t0 || 1)) * W, H - 8 - ((v.value - min) / span) * (H - 16)] as const);
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
  const qc = useQueryClient();
  const today = useToday();
  const [val, setVal] = useState("");
  const [vd, setVd] = useState(today);
  const [dep, setDep] = useState("");
  const [dd, setDd] = useState(today);
  const [busy, setBusy] = useState(false);
  const parse = (x: string) => { const n = parseFloat(x.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; };
  const hand = d.entries.filter((e) => !e.estimated && e.note !== "auto");
  const first = d.st.start;
  const holdings = depotHoldings(s);
  const legacy = !!s.investSymbol && !s.investHoldings;
  async function refresh() {
    setBusy(true);
    try {
      const r = await api.money.depotRefresh();
      notify(r.message);
      void qc.invalidateQueries({ queryKey: ["invest"] });
    } catch {
      notify("Abruf nicht möglich");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h3>Portfolio</h3>
      {d.error && <div className="empty" role="alert">Portfolio konnte nicht geladen werden. Bitte erneut versuchen.</div>}
      {d.loading && <div className="empty" role="status">Portfolio wird geladen</div>}
      <div className="when">{d.latest ? `Stand ${dayCompact(d.latest.date)}${d.latest.estimated ? " · geschätzt" : ""}` : "Startbestand eintragen"}</div>
      {d.latest ? <Money v={d.latest.value} size={38} /> : <div className="bigv faint">–</div>}
      {d.latest && (
        <div className={d.latest.gain === 0 ? "muted" : d.latest.gain > 0 ? "good" : "bad"} style={{ fontWeight: 600, marginTop: 2 }}>
          <Money v={d.latest.gain} size={17} cur={false} signed />{d.pct !== null && <span style={{ marginLeft: 8 }}>{pctText(d.pct)}</span>}
        </div>
      )}
      <ValueLine values={d.series} />
      {d.latest && <div className="row"><div className="l"><b>Einbezahlt</b></div><span className="r"><Money v={d.deposits} size={17} cur={false} /></span></div>}
      <div className="sec">{first ? "Neuer Wert" : "Startbestand"}</div>
      <div className="field"><label htmlFor="d-v">Betrag</label><input id="d-v" className="inp num" style={{ width: 110 }} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></div>
      <div className="field"><label htmlFor="d-d">Datum</label><input id="d-d" className="inp" type="date" value={vd} onChange={(e) => setVd(e.target.value)} /></div>
      <button type="button" className="cta press" disabled={add.isPending || parse(val) === null || !vd} onClick={() => { add.mutate({ id: uid(), kind: "value", date: vd, amount: parse(val)! }, { onSuccess: () => setVal("") }); }}>{first ? "Wert speichern" : "Startbestand speichern"}</button>
      <div className="sec">Einzahlungen</div>
      <div className="field"><label htmlFor="d-m">Pro Monat</label><input id="d-m" className="inp num" inputMode="decimal" defaultValue={s.investMonthly} onBlur={(e) => { const n = parse(e.target.value); if (n !== null && String(n) !== s.investMonthly) setS({ investMonthly: String(n) }); }} /></div>
      <div className="field"><label htmlFor="d-t">Am</label><input id="d-t" className="inp num" style={{ width: 70 }} inputMode="numeric" defaultValue={s.investDay} onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= 28 && String(n) !== s.investDay) setS({ investDay: String(n) }); else e.target.value = s.investDay; }} /></div>
      <div className="field"><label htmlFor="d-e">Nachtragen</label><input id="d-e" className="inp num" style={{ width: 110 }} inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} /></div>
      <div className="field"><label htmlFor="d-ed">Datum</label><input id="d-ed" className="inp" type="date" value={dd} onChange={(e) => setDd(e.target.value)} /></div>
      <button type="button" className="cta ghost press" disabled={add.isPending || parse(dep) === null || !dep || !dd} onClick={() => { add.mutate({ id: uid(), kind: "deposit", date: dd, amount: parse(dep)!, note: "von Hand" }, { onSuccess: () => setDep("") }); }}>Einzahlung eintragen</button>
      {legacy && <>      <div className="sec">Genau rechnen</div>
      <div className="field"><label htmlFor="d-k">Kürzel</label><input id="d-k" className="inp" style={{ width: 110 }} autoCapitalize="characters" defaultValue={s.investSymbol} placeholder="z.B. VOO" onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== s.investSymbol) setS({ investSymbol: v }); }} /></div>
      <div className="field"><label htmlFor="d-a">Anteile</label><input id="d-a" className="inp num" style={{ width: 110 }} inputMode="decimal" defaultValue={s.investShares} onBlur={(e) => { const n = parse(e.target.value); const v = n === null ? "" : String(n); if (v !== s.investShares) setS({ investShares: v }); }} /></div>
      <div className="field"><label htmlFor="d-w">Währung</label>
        <select id="d-w" className="inp" value={s.investCurrency} onChange={(e) => setS({ investCurrency: e.target.value as "USD" | "CHF" | "EUR" })}>
          <option value="USD">USD</option><option value="CHF">CHF</option><option value="EUR">EUR</option>
        </select></div>
      <div className="when" style={{ marginTop: 6 }}>Bisherige Einzelposition</div>
</>}
      <PortfolioPositions key={s.investHoldings + s.investSymbol} holdings={legacy ? null : holdings} />
      <button type="button" className="cta ghost press" disabled={busy || !first} onClick={refresh}>Jetzt abrufen</button>
      {hand.length > 0 && <div className="sec">Einträge</div>}
      {[...hand].reverse().map((e) => (
        <div key={e.id} className="row">
          <div className="l"><b>{e.kind === "deposit" ? "Einzahlung" : first && e.date === first.date && e.amount === first.amount ? "Startbestand" : "Wert"} · <Money v={e.amount} size={16} cur={false} /></b><span>{dayCompact(e.date)}</span></div>
          <button type="button" className="iconbtn press" aria-label="Eintrag löschen" onClick={() => rem.mutate(e.id)}><Icon n="trash" /></button>
        </div>
      ))}
    </div>
  );
}

function PortfolioPositions({ holdings }: { holdings: ReturnType<typeof depotHoldings> }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => holdings?.map(h => ({ symbol: h.symbol, shares: String(h.shares) })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(rows = draft) {
    setError("");
    const values = rows.map(h => ({ symbol: h.symbol, shares: Number(h.shares.replace(",", ".")) }));
    if (values.some(h => !portfolioProduct(h.symbol) || !Number.isFinite(h.shares) || h.shares <= 0)) {
      setError("Für jede Position eine positive Anzahl Anteile eintragen."); return;
    }
    setBusy(true);
    try {
      await api.settings.put({ investHoldings: JSON.stringify(values) });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      notify("Positionen gespeichert");
    } catch { setError("Positionen nicht gespeichert. Deine Eingaben bleiben erhalten."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="sec">Positionen</div>
    <div className="when">Bewertung aller Positionen mit Tradegate Kursen in EUR, umgerechnet in CHF. VUAA: S&amp;P 500. XNAS: Nasdaq 100. NVIDIA: Einzelaktie.</div>
    {draft.map((h, i) => <div className="field" key={h.symbol}>
      <label htmlFor={`holding-${h.symbol}`}>{h.symbol} Anteile</label>
      <input id={`holding-${h.symbol}`} className="inp num" style={{ width: 110 }} inputMode="decimal" value={h.shares} onChange={e => setDraft(d => d.map((r, j) => j === i ? { ...r, shares: e.target.value } : r))} />
      <button type="button" className="iconbtn press" aria-label={`${h.symbol} entfernen`} onClick={() => setDraft(d => d.filter((_, j) => j !== i))}><Icon n="trash" /></button>
    </div>)}
    {PORTFOLIO_PRODUCTS.filter(p => !draft.some(h => h.symbol === p.symbol)).map(p => <button type="button" className="chip btn press" key={p.symbol} onClick={() => setDraft(d => [...d, { symbol: p.symbol, shares: "" }])}>{p.symbol} hinzufügen</button>)}
    {error && <div className="bad" role="alert">{error}</div>}
    <button type="button" className="cta ghost press" disabled={busy} onClick={() => void save()}>{busy ? "Speichert" : "Positionen speichern"}</button>
    {!holdings && <button type="button" className="cta ghost press" disabled={busy} onClick={() => { const rows = CONFIRMED_HOLDINGS.map(h => ({ symbol: h.symbol, shares: String(h.shares) })); setDraft(rows); void save(rows); }}>VUAA 12.2, XNAS 23, NVIDIA 3 übernehmen</button>}
    <div className="when" style={{ marginTop: 6 }}>Anteile nach Käufen und Verkäufen aktualisieren. Neue Kurse gelten ab dem letzten Handwert. Es entsteht nur mit Kursen für alle Positionen ein Gesamtwert.</div>
  </>;
}

export const _unused = { addDays, daysBetween, byCategory };
