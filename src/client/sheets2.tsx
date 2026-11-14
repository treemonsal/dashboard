import { useState } from "react";
import { addDays, dayCompact } from "../shared/dates";
import { byCategory } from "../shared/geld";
import { Money, Segments, nf, hm } from "./ui";
import { CatIcon, SpendChart, TxRow, monthTitle } from "./geld";
import { useMonthMoney } from "./lib";
import { useAccounts, useCategories, useHealth, usePutHealth, useToday } from "./queries";

/** Blatt "Übrig": dasselbe wie der Geld-Tab, kompakt. */
export function GeldSheet() {
  const m = useMonthMoney();
  const cats = useCategories().data ?? [];
  const accs = useAccounts().data ?? [];
  const today = useToday();
  const by = byCategory(m.txs);
  return (
    <div>
      <h3>Übrig</h3>
      <div className="when">{monthTitle(m.month)}</div>
      {!m.summary.hasData ? (
        <div className="empty">Noch kein Export hochgeladen.</div>
      ) : (
        <>
          <Money v={m.summary.left} size={38} />
          <div style={{ marginTop: 12 }}><SpendChart txs={m.txs} month={m.month} budget={m.budget} today={today} /></div>
          <div className="sec">Ausgaben nach Kategorie</div>
          {by.map((b) => {
            const c = cats.find((x) => x.id === b.categoryId);
            return (
              <div key={b.categoryId ?? "none"} className="lrow" style={{ minHeight: 56 }}>
                <CatIcon name={c?.name} />
                <span className="w"><b>{c?.name ?? "Ohne Kategorie"}</b></span>
                <span className="a"><Money v={b.amount} size={17} cur={false} /></span>
              </div>
            );
          })}
          <div className="sec">Buchungen</div>
          {m.txs.slice(0, 20).map((t) => (<TxRow key={t.id} t={t} cats={cats} />))}
        </>
      )}
      <div className="sec">Konten</div>
      <div className="acc">
        {accs.map((a) => (<span key={a.id}>{a.name}<b className={a.balance === 0 ? "none" : ""}>{a.balance === 0 ? "–" : nf(a.balance)}</b></span>))}
      </div>
      <span hidden>{dayCompact(addDays(today, 0))}</span>
    </div>
  );
}

type Metric = "sleep" | "steps" | "hr" | "weight";
const M: Record<Metric, { title: string; key: "sleepMin" | "steps" | "restingHr" | "weightKg"; fmt: (v: number) => string; unit?: string; line?: boolean }> = {
  sleep: { title: "Schlaf", key: "sleepMin", fmt: (v) => hm(v) },
  steps: { title: "Schritte", key: "steps", fmt: (v) => nf(v) },
  hr: { title: "Ruhepuls", key: "restingHr", fmt: (v) => String(Math.round(v)), unit: "bpm" },
  weight: { title: "Gewicht", key: "weightKg", fmt: (v) => nf(v, 1), unit: "kg", line: true },
};

export function HealthSheet({ metric }: { metric: Metric }) {
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const cfg = M[metric];
  const h = useHealth(range);
  const put = usePutHealth();
  const today = useToday();
  const [kg, setKg] = useState("");
  const days = Array.from({ length: range }, (_, i) => addDays(h.to, -(range - 1 - i)));
  const byDay = new Map(h.rows.map((r) => [r.day, r[cfg.key]]));
  const vals = days.map((d) => byDay.get(d) ?? null);
  const have = vals.filter((v): v is number => v !== null);
  const avg = have.length ? have.reduce((a, b) => a + b, 0) / have.length : null;
  const max = Math.max(1, ...have);
  const min = Math.min(...have, max);
  const W = 300, H = 130;
  const bw = W / range;
  const wpts = vals.map((v, i) => (v === null ? null : [(i + 0.5) * bw, H - 10 - ((v - min) / (max - min || 1)) * (H - 24)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const empty = have.length === 0;
  const w = parseFloat(kg.replace(",", "."));
  return (
    <div>
      <h3>{cfg.title}</h3>
      <Segments value={range} onChange={setRange} options={[{ v: 7, label: "7 Tage" }, { v: 30, label: "30" }, { v: 90, label: "90" }]} label="Zeitraum" />
      {empty ? (
        <div className="empty" style={{ paddingTop: 18 }}>{metric === "weight" ? "Noch kein Gewicht eingetragen." : "Noch nicht mit Fitbit verbunden."}</div>
      ) : (
        <>
          <div style={{ margin: "16px 0 6px" }}>
            <span className="bigv">{cfg.fmt(avg!)}{cfg.unit && <small>{cfg.unit}</small>}</span>
            <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>Schnitt</span>
          </div>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Verlauf ${cfg.title}`}>
            <line className="base" x1="0" x2={W} y1={H - 1} y2={H - 1} />
            {cfg.line ? (
              <>
                <path d={wpts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")} vectorEffect="non-scaling-stroke" />
              </>
            ) : (
              vals.map((v, i) => v !== null && <rect key={days[i]} x={i * bw + bw * 0.15} width={bw * 0.7} y={H - (v / max) * (H - 6)} height={(v / max) * (H - 6)} rx={Math.min(3, bw / 3)} />)
            )}
          </svg>
        </>
      )}
      {metric === "weight" && (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="kg">Heute</label>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id="kg" className="inp num" inputMode="decimal" placeholder="–" value={kg} onChange={(e) => setKg(e.target.value)} />
              <span className="faint">kg</span>
            </span>
          </div>
          <button type="button" className="cta press" disabled={!(w >= 20 && w <= 400)} onClick={() => { put.mutate({ day: today, patch: { weightKg: Math.round(w * 10) / 10 } }); setKg(""); }}>Eintragen</button>
        </>
      )}
      <span hidden>{dayCompact(today)}</span>
    </div>
  );
}
