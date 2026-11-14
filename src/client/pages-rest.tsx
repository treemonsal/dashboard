import { useEffect, useRef, useState } from "react";
import { AbgleichLaeufe, VerbundeneApps } from "./einstellungen-apps";
import { FitbitEinstellungen, FitbitLeer } from "./fitbit";
import { Trainings } from "./trainings";
import { ErinnerungenEinstellungen, KalenderEinstellungen } from "./einstellungen-kalender";
import { addDays, dayCompact, daysBetween, daysUntil, mondayOf, minutesOf, timeInZone, monthLong, WEEKDAY_LETTERS, WEEK_ORDER, weekdayNum } from "../shared/dates";
import { byCategory, ownShare } from "../shared/geld";
import { api } from "./api";
import { Link } from "./router";
import { useSheet } from "./sheet";
import { ExamSheet, PlanSheet } from "./sheets";
import { HealthSheet } from "./sheets2";
import { DepotSheet, CatIcon, MamaSheet, SpendChart, TxRow, monthTitle, pctText, useDepot, useMama } from "./geld";
import { DayToggles, DetailHead, Empty, Icon, Money, RoundAction, PageTitle, nf, hm } from "./ui";
import { GymCard } from "./cards";
import { useMonthMoney, useLatest } from "./lib";
import { useAccounts, useAllTransactions, useCategories, useExams, useGymPlans, useNow, useSetSetting, useSettings, useTasks, useToday, useTransactions } from "./queries";
import { notify } from "./toast";
import { UploadAction } from "./import";

const dayList = (s: string) => (s ? s.split(",").map(Number) : []);

/* ---------- Geld ---------- */
export function Geld() {
  const today = useToday();
  const sheet = useSheet();
  const [month, setMonth] = useState(today.slice(0, 7));
  const m = useMonthMoney();
  const q = useTransactions(month);
  const accs = useAccounts().data ?? [];
  const cats = useCategories().data ?? [];
  const all = useAllTransactions().data ?? [];
  const mama = useMama();
  const dep = useDepot();
  const s = useSettings();
  const txs = q.data ?? [];
  const spent = txs.reduce((a, t) => a + ownShare(t), 0);
  const shift = (n: number) => { const [y, mo] = month.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const hasAny = all.length > 0;
  return (
    <div className="view">
      <PageTitle>Geld</PageTitle>
      <div className="center">
        <div className="lbl">Übrig</div>
        {hasAny ? <Money v={m.budget - spent} size={52} /> : <span className="bigv faint" style={{ fontSize: 52 }}>–</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="iconbtn press" aria-label="Voriger Monat" onClick={() => shift(-1)}><Icon n="back" /></button>
          <span className="chip">{month === today.slice(0, 7) ? "Diesen Monat" : `${monthTitle(month)} ${month.slice(0, 4)}`}</span>
          <button type="button" className="iconbtn press" aria-label="Nächster Monat" style={{ transform: "scaleX(-1)" }} disabled={month >= today.slice(0, 7)} onClick={() => shift(1)}><Icon n="back" /></button>
        </div>
      </div>
      <div className="acts">
        <UploadAction />
        <RoundAction icon="chart" label="Analyse" href="/analyse" />
        <RoundAction icon="coin" label="Depot" onClick={() => sheet.open(<DepotSheet />)} />
        <RoundAction icon="fork" label="Offen von Mama" onClick={() => sheet.open(<MamaSheet />)} />
      </div>

      <div className="card">
        <h2>Ausgegeben</h2>
        {hasAny ? (
          <div style={{ paddingBottom: 14 }}>
            <Money v={spent} size={34} />
            <div style={{ marginTop: 10 }}><SpendChart txs={txs} month={month} budget={m.budget} today={today} /></div>
          </div>
        ) : (
          <div className="empty">Noch kein Export hochgeladen.</div>
        )}
      </div>

      {mama.any && (
        <button type="button" className="card tap press" onClick={() => sheet.open(<MamaSheet />)}>
          <div className="lrow" style={{ borderTop: 0 }}>
            <span className="ic" style={{ background: "var(--card2)" }}><Icon n="fork" /></span>
            <span className="w"><b>Offen von Mama</b>{s.mamaName && <span>{s.mamaName}</span>}</span>
            <span className="a"><Money v={mama.open} size={17} cur={false} /></span>
          </div>
        </button>
      )}

      <div className="card">
        <h2>Konten</h2>
        <div className="acc" style={{ paddingBottom: 14 }}>
          {accs.map((a) => (<span key={a.id}>{a.name}<b className={a.balance === 0 ? "none" : ""}>{a.balance === 0 ? "–" : nf(a.balance)}</b></span>))}
        </div>
      </div>

      <button type="button" className="card tap press" onClick={() => sheet.open(<DepotSheet />)}>
        <h2>Depot S&amp;P 500</h2>
        <div style={{ paddingBottom: 14 }}>
          {dep.latest ? <Money v={dep.latest.value} size={30} /> : <span className="muted" style={{ fontSize: 15 }}>Startbestand eintragen</span>}
          {dep.latest && <div className={dep.latest.gain === 0 ? "muted" : dep.latest.gain > 0 ? "good" : "bad"} style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}><Money v={dep.latest.gain} size={17} cur={false} signed />{dep.pct !== null && <span style={{ marginLeft: 8 }}>{pctText(dep.pct)}</span>}</div>}
        </div>
      </button>

      {hasAny && (
        <div className="card">
          <h2>Buchungen</h2>
          {txs.slice(0, 8).map((t) => (<TxRow key={t.id} t={t} cats={cats} />))}
          {txs.length === 0 && <div className="empty">Keine Buchungen in diesem Monat.</div>}
          {txs.length > 8 && <button type="button" className="more press" onClick={() => sheet.open(<AllTx month={month} />)}>Alle anzeigen</button>}
        </div>
      )}
    </div>
  );
}

function AllTx({ month }: { month: string }) {
  const txs = useTransactions(month).data ?? [];
  const cats = useCategories().data ?? [];
  return (<div><h3>Buchungen</h3><div className="when">{monthTitle(month)}</div>{txs.map((t) => (<TxRow key={t.id} t={t} cats={cats} />))}</div>);
}

export function Analyse() {
  const today = useToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const txs = useTransactions(month).data ?? [];
  const cats = useCategories().data ?? [];
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const weeks = [[1, 7], [8, 14], [15, 21], [22, 28], ...(days > 28 ? [[29, days]] : [])];
  const sums = weeks.map(([a, b]) => txs.filter((t) => { const d = +t.date.slice(8, 10); return d >= a && d <= b; }).reduce((s, t) => s + ownShare(t), 0));
  const mx = Math.max(1, ...sums);
  const total = sums.reduce((a, b) => a + b, 0);
  const by = byCategory(txs);
  const shift = (n: number) => { const [y, mo] = month.split("-").map(Number); setMonth(new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7)); };
  return (
    <div className="view">
      <DetailHead title="Analyse" back="/geld" />
      <div className="center">
        {txs.length ? <Money v={total} size={44} /> : <span className="bigv faint" style={{ fontSize: 44 }}>–</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="iconbtn press" aria-label="Voriger Monat" onClick={() => shift(-1)}><Icon n="back" /></button>
          <span className="chip">{month === today.slice(0, 7) ? "Diesen Monat" : `${monthTitle(month)} ${month.slice(0, 4)}`}</span>
          <button type="button" className="iconbtn press" aria-label="Nächster Monat" style={{ transform: "scaleX(-1)" }} disabled={month >= today.slice(0, 7)} onClick={() => shift(1)}><Icon n="back" /></button>
        </div>
      </div>
      {txs.length === 0 ? (
        <div className="card"><div className="empty">Noch kein Export hochgeladen.</div></div>
      ) : (
        <>
          <div className="card">
            <h2>Pro Woche</h2>
            <div className="wbars">
              {weeks.map(([a, b], i) => (
                <div key={a}><span>{nf(sums[i])}</span><i style={{ height: `${(sums[i] / mx) * 80}%` }} /><span>{a}–{b}</span></div>
              ))}
            </div>
            <div style={{ height: 14 }} />
          </div>
          <div className="card">
            <h2>Kategorien</h2>
            {by.map((b) => {
              const c = cats.find((x) => x.id === b.categoryId);
              const n = txs.filter((t) => (t.categoryId ?? null) === b.categoryId && ownShare(t) > 0).length;
              return (
                <div key={b.categoryId ?? "none"} className="lrow">
                  <CatIcon name={c?.name} />
                  <span className="w"><b>{c?.name ?? "Ohne Kategorie"}</b><span>{n} Buchungen · {Math.round((b.amount / total) * 100)} %</span></span>
                  <span className="a"><Money v={b.amount} size={17} cur={false} /></span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Körper ---------- */
export function Koerper() {
  const sheet = useSheet();
  const sleep = useLatest("sleepMin");
  const steps = useLatest("steps");
  const hr = useLatest("restingHr");
  const w = useLatest("weightKg");
  const connected = [...sleep.rows, ...steps.rows, ...hr.rows].some((r) => r.source === "fitbit");
  const Stat = ({ k, metric, v, unit }: { k: string; metric: "sleep" | "steps" | "hr" | "weight"; v: string | null; unit?: string }) => (
    <button type="button" className="stat press" onClick={() => sheet.open(<HealthSheet metric={metric} />)}>
      <span className="k">{k}</span>
      <span className={`v ${v === null ? "none" : ""}`}>{v ?? "–"}{v !== null && unit && <small>{unit}</small>}</span>
    </button>
  );
  return (
    <div className="view">
      <PageTitle>Körper</PageTitle>
      {!connected && <FitbitLeer />}
      <div className="grid2">
        <Stat k="Schlaf" metric="sleep" v={sleep.latest?.sleepMin != null ? hm(sleep.latest.sleepMin) : null} />
        <Stat k="Schritte" metric="steps" v={steps.latest?.steps != null ? nf(steps.latest.steps) : null} />
        <Stat k="Ruhepuls" metric="hr" v={hr.latest?.restingHr != null ? String(hr.latest.restingHr) : null} unit="bpm" />
        <Stat k="Gewicht" metric="weight" v={w.latest?.weightKg != null ? nf(w.latest.weightKg, 1) : null} unit="kg" />
      </div>
      <Trainings />
      <GymCard />
    </div>
  );
}

/* ---------- Pläne ---------- */
export function Plaene() {
  const plans = useGymPlans().data ?? [];
  const sheet = useSheet();
  return (
    <div className="view">
      <DetailHead title="Pläne" back="/ziele" />
      <div className="card">
        {plans.length === 0 && <Empty action={{ label: "Plan anlegen", onClick: () => sheet.open(<PlanSheet id={null} />) }}>Noch kein Trainingsplan.</Empty>}
        {plans.map((p) => (
          <button key={p.id} type="button" className="lrow press" onClick={() => sheet.open(<PlanSheet id={p.id} />)}>
            <span className="ic"><Icon n="dumbbell" /></span>
            <span className="w">
              <b>{p.name}</b>
              <span>{[...p.weekdays].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)).map((d) => WEEKDAY_LETTERS[d]).join(", ") || "Kein Wochentag"}</span>
            </span>
            <span className={`a ${p.exercises.length ? "muted" : "faint"}`} style={{ fontSize: 14 }}>{p.exercises.length ? `${p.exercises.length} Übungen` : "Übungen hinzufügen"}</span>
          </button>
        ))}
      </div>
      {plans.length > 0 && <button type="button" className="cta press" style={{ margin: 0 }} onClick={() => sheet.open(<PlanSheet id={null} />)}>Plan anlegen</button>}
    </div>
  );
}

/* ---------- Zeit ---------- */
function LifeGrid({ birth, today }: { birth: string; today: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lived = Math.floor(daysBetween(birth, today) / 7);
  const COLS = 52, ROWS = 80;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const cell = w / COLS;
    c.width = w * dpr;
    c.height = cell * ROWS * dpr;
    c.style.height = `${cell * ROWS}px`;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const col = { fg: css.getPropertyValue("--fg").trim(), now: css.getPropertyValue("--orange").trim(), dot: css.getPropertyValue("--dot").trim() };
    const pad = Math.max(0.6, cell * 0.16);
    for (let i = 0; i < COLS * ROWS; i++) {
      g.fillStyle = i < lived ? col.fg : i === lived ? col.now : col.dot;
      const x = (i % COLS) * cell, y = Math.floor(i / COLS) * cell;
      g.beginPath();
      g.roundRect(x + pad / 2, y + pad / 2, cell - pad, cell - pad, 1);
      g.fill();
    }
  }, [lived]);
  return (
    <>
      <div className="yh"><b>{nf(lived)}</b><span>von {nf(COLS * ROWS)} Wochen</span></div>
      <canvas ref={ref} className="life" role="img" aria-label={`Leben in Wochen: ${lived} von ${COLS * ROWS}`} style={{ width: "100%", marginBottom: 16 }} />
    </>
  );
}

export function Zeit() {
  const now = useNow();
  const today = useToday();
  const s = useSettings();
  const exams = useExams().data ?? [];
  const tasks = useTasks().data ?? [];
  const sheet = useSheet();
  const y = Number(today.slice(0, 4));
  const examDays = new Set(exams.map((e) => e.date));
  const monday = mondayOf(today);
  const nowMin = minutesOf(timeInZone(now));
  const a = minutesOf(s.wakeTime), b = minutesOf(s.sleepTime);
  const pct = Math.max(0, Math.min(100, ((nowMin - a) / (b - a)) * 100));
  const left = Math.max(0, b - Math.max(nowMin, a));
  const marks = tasks.filter((t) => t.dueDate === today && t.dueTime && !t.doneAt).map((t) => ((minutesOf(t.dueTime!) - a) / (b - a)) * 100).filter((p) => p > 0 && p < 100);
  const workDays = dayList(s.workDays), schoolDays = dayList(s.schoolDays);
  return (
    <div className="view">
      <DetailHead title="Zeit" />
      <div className="card">
        <h2>{y}</h2>
        <div className="months">
          {Array.from({ length: 12 }, (_, mi) => {
            const first = `${y}-${String(mi + 1).padStart(2, "0")}-01`;
            const n = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
            const off = (weekdayNum(first) + 6) % 7;
            return (
              <div key={mi}>
                <div className="mn">{monthLong(mi + 1).slice(0, 3)}</div>
                <div className="md">
                  {Array.from({ length: off }, (_, i) => (<span key={`o${i}`} />))}
                  {Array.from({ length: n }, (_, i) => {
                    const d = addDays(first, i);
                    return <i key={d} className={d < today ? "p" : d === today ? "now" : examDays.has(d) ? "x" : ""} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Diese Woche</h2>
        <div className="week">
          {WEEK_ORDER.map((wd, i) => {
            const d = addDays(monday, i);
            return (
              <div key={d} className={d < today ? "p" : d === today ? "now" : ""}>
                <i />
                {WEEKDAY_LETTERS[wd]}
                <div style={{ fontSize: 10, marginTop: 2 }} className="faint">{workDays.includes(wd) ? "Lehre" : schoolDays.includes(wd) ? "Schule" : ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Heute <span>{s.wakeTime} bis {s.sleepTime}</span></h2>
        <div className="tbar" role="img" aria-label={`Noch ${hm(left)} wach`}>
          <i style={{ width: `${pct}%` }} />
          {marks.map((m, i) => (<b key={i} style={{ left: `${m}%` }} />))}
        </div>
        <div className="yh" style={{ paddingTop: 4 }}>
          <b>{nowMin < a ? "–" : hm(left)}</b>
          <span>{nowMin >= b ? "Schlafenszeit" : "noch wach"}</span>
        </div>
      </div>

      <div className="card">
        <h2>Prüfungen</h2>
        {exams.length === 0 && <div className="empty">Keine kommenden Prüfungen.</div>}
        {exams.map((e) => {
          const n = daysUntil(e.date);
          return (
            <button key={e.id} type="button" className="ex press" onClick={() => sheet.open(<ExamSheet id={e.id} />)}>
              <span className="f">{e.subjectCode}</span>
              <span className="w"><b>{e.title}</b><span>{dayCompact(e.date)}</span></span>
              <span className={`n${n < 15 ? " soon" : ""}`}>{n} T</span>
            </button>
          );
        })}
      </div>

      <div className="card">
        <h2>Leben in Wochen</h2>
        {s.birthDate ? (
          <LifeGrid birth={s.birthDate} today={today} />
        ) : (
          <div className="empty">
            <span>Geburtsdatum in den Einstellungen eintragen.</span>
            <Link href="/einstellungen" className="chip btn press">Einstellungen</Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Einstellungen ---------- */
export function Einstellungen() {
  const s = useSettings();
  const set = useSetSetting();
  const num = (x: string) => { const n = parseFloat(x.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; };
  async function exportAll() {
    try {
      const data = await api.exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      notify("Export fehlgeschlagen");
    }
  }
  return (
    <div className="view">
      <DetailHead title="Einstellungen" />
      <div className="card" style={{ paddingTop: 0 }}>
        <div className="field" style={{ borderTop: 0 }}><label htmlFor="s-b">Geburtsdatum</label><input id="s-b" className="inp" type="date" value={s.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="s-w">Aufstehen</label><input id="s-w" className="inp" type="time" value={s.wakeTime} onChange={(e) => e.target.value && set({ wakeTime: e.target.value })} /></div>
        <div className="field"><label htmlFor="s-s">Schlafen</label><input id="s-s" className="inp" type="time" value={s.sleepTime} onChange={(e) => e.target.value && set({ sleepTime: e.target.value })} /></div>
        <div className="field" style={{ flexDirection: "column", alignItems: "flex-start", padding: "10px 0", gap: 8 }}><span>Arbeitstage</span><DayToggles label="Arbeitstage" value={dayList(s.workDays)} onChange={(v) => set({ workDays: [...v].sort().join(",") })} /></div>
        <div className="field" style={{ flexDirection: "column", alignItems: "flex-start", padding: "10px 0", gap: 8 }}><span>Schultage</span><DayToggles label="Schultage" value={dayList(s.schoolDays)} onChange={(v) => set({ schoolDays: [...v].sort().join(",") })} /></div>
        <div className="field"><span>Gym pro Woche</span>
          <span className="seg" role="group" aria-label="Gym pro Woche">
            <button type="button" className="press" aria-label="Weniger" onClick={() => Number(s.gymGoal) > 1 && set({ gymGoal: String(Number(s.gymGoal) - 1) })}>−</button>
            <button type="button" disabled style={{ color: "var(--fg)" }}>{s.gymGoal}</button>
            <button type="button" className="press" aria-label="Mehr" onClick={() => Number(s.gymGoal) < 7 && set({ gymGoal: String(Number(s.gymGoal) + 1) })}>+</button>
          </span>
        </div>
      </div>
      <div className="card" style={{ paddingTop: 0 }}>
        <div className="field" style={{ borderTop: 0 }}><label htmlFor="s-l">Lohn pro Monat</label><input id="s-l" className="inp num" inputMode="decimal" defaultValue={s.salary} onBlur={(e) => { const n = num(e.target.value); if (n !== null && String(n) !== s.salary) set({ salary: String(n) }); }} /></div>
        <div className="field"><label htmlFor="s-i">Einzahlung S&amp;P 500</label><input id="s-i" className="inp num" inputMode="decimal" defaultValue={s.investMonthly} onBlur={(e) => { const n = num(e.target.value); if (n !== null && String(n) !== s.investMonthly) set({ investMonthly: String(n) }); }} /></div>
        <div className="field"><label htmlFor="s-m">Mahlzeiten zahlt</label><input id="s-m" className="inp" placeholder="Name" defaultValue={s.mamaName} maxLength={60} onBlur={(e) => e.target.value.trim() !== s.mamaName && set({ mamaName: e.target.value.trim() })} /></div>
      </div>
      <KalenderEinstellungen />
      <ErinnerungenEinstellungen />
      <FitbitEinstellungen />
      <VerbundeneApps />
      <AbgleichLaeufe />
      <div className="card" style={{ paddingTop: 0 }}>
        <Link href="/plaene" className="row press" style={{ borderTop: 0 }}><div className="l"><b>Trainingspläne</b></div><Icon n="chev" className="" /></Link>
        <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} onClick={exportAll}><div className="l"><b>Daten exportieren</b></div><span className="r">JSON</span></button>
      </div>
    </div>
  );
}
