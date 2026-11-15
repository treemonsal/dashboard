// Körper in die Tiefe unter /koerper/...
//   <schlaf|schritte|ruhepuls|gewicht>[/<montag>[/<tag>]]   Übersicht (7/30/90), Woche, Tag oder Nacht
//   trainings[/woche/<montag>[/<id>]] und trainings/art/<art>[/<id>]   Wochen, Training, Detail, gleiche Art
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryNotice, SaveNotice } from "./query-state";
import { Link, navigate } from "./router";
import { addDays, dayCompact, mondayOf, weekdayLong } from "../shared/dates";
import { avgOf, diffPct, mondaysBetween, weekAverages, weekDays } from "../shared/tiefe";
import { Icon, Meter, Segments, hm, nf } from "./ui";
import { NotFound, Stage, type Crumb } from "./tiefe";
import { call } from "./fitbit-setup";
import { api } from "./api";
import { keys, usePutHealth, useToday } from "./queries";
import { fmtMin, isWalk, useWorkouts, workoutIcon, workoutTitle, type WorkoutRow } from "./trainings";
import { useSetSetting, useSettings } from "./queries";
import type { HealthDay } from "../shared/schemas";

type Key = "sleepMin" | "steps" | "restingHr" | "weightKg";
const M: Record<string, { title: string; key: Key; fmt: (v: number) => string; unit: string; day: string }> = {
  schlaf: { title: "Schlaf", key: "sleepMin", fmt: (v) => hm(v), unit: "", day: "Nacht" },
  schritte: { title: "Schritte", key: "steps", fmt: (v) => nf(v), unit: "", day: "Tag" },
  ruhepuls: { title: "Ruhepuls", key: "restingHr", fmt: (v) => String(Math.round(v)), unit: " bpm", day: "Tag" },
  gewicht: { title: "Gewicht", key: "weightKg", fmt: (v) => nf(v, 1), unit: " kg", day: "Tag" },
};
const short = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`;
const span = (monday: string) => `${short(monday)}–${short(addDays(monday, 6))}`;

function useRange(from: string, to: string) {
  const q = useQuery({ queryKey: keys.health(from, to), queryFn: () => api.health.list(from, to) });
  return { rows: q.data ?? [], ok: q.isSuccess, pending: q.isPending, error: q.error };
}
export interface Night { day: string; startAt: string; endAt: string; asleepMin: number | null; awakeMin: number | null; deepMin: number | null; lightMin: number | null; remMin: number | null }
const useNight = (day: string) => useQuery({ queryKey: ["health-sleep", day], queryFn: async () => (await call<Night[]>("GET", `/sleep?from=${day}&to=${day}`))[0] ?? null });
const clock = (iso: string) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const byDay = (rows: HealthDay[], key: Key) => new Map(rows.map((r) => [r.day, r[key]] as [string, number | null]));

export function KoerperTiefe({ path }: { path: string }) {
  const segs = path.split("/").filter(Boolean).slice(1);
  if (segs[0] === "trainings") return <Trainings segs={segs} />;
  const cfg = M[segs[0] ?? ""];
  if (!cfg) return <Stage title="Körper" back="/koerper"><NotFound /></Stage>;
  const m = segs[0]!;
  if (segs[2]) return <Tag m={m} monday={segs[1]!} day={segs[2]} />;
  if (segs[1]) return <Woche m={m} monday={segs[1]} />;
  return <Uebersicht m={m} />;
}

/* ---------- Übersicht mit Schnitt ---------- */
function Uebersicht({ m }: { m: string }) {
  const cfg = M[m]!;
  const today = useToday();
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const from = addDays(today, -(range - 1));
  const r = useRange(from, today);
  const put = usePutHealth();
  const [kg, setKg] = useState("");
  const map = byDay(r.rows, cfg.key);
  const inRange = new Map([...map].filter(([d]) => d >= from && d <= today));
  const avg = avgOf([...inRange.values()]);
  const weeks = weekAverages(inRange, mondaysBetween(from, today));
  const mx = Math.max(1, ...weeks.map((w) => w.avg ?? 0));
  const w = parseFloat(kg.replace(",", "."));
  return (
    <Stage title={cfg.title} back="/koerper" crumbs={[{ label: cfg.title }]}>
      <Segments value={range} onChange={setRange} options={[{ v: 7, label: "7 Tage" }, { v: 30, label: "30" }, { v: 90, label: "90" }]} label="Zeitraum" />
      <div className="center">
        {avg !== null ? <span className="bigv">{cfg.fmt(avg)}<small>{cfg.unit}</small></span> : <span className="bigv faint">–</span>}
        <span className="lbl">Schnitt der letzten {range} Tage</span>
      </div>
      {!r.ok ? <QueryNotice pending={r.pending} error={r.error} /> : avg === null ? <div className="card"><div className="empty">Keine Messwerte in diesem Zeitraum.</div></div> : (
        <div className="card">
          <h2>Pro Woche</h2>
          <div className="wbars" style={{ gap: weeks.length > 8 ? 3 : 10 }}>
            {weeks.map((x) => (
              <Link key={x.monday} href={`/koerper/${m}/${x.monday}`} className="press" aria-label={`Woche ab ${dayCompact(x.monday)}`}>
                <span>{x.avg !== null ? (m === "schlaf" ? `${(x.avg / 60).toFixed(1)}` : m === "schritte" ? `${Math.round(x.avg / 1000)}k` : cfg.fmt(x.avg)) : ""}</span>
                <i className={x.avg === null ? "dim" : ""} style={{ height: `${((x.avg ?? 0) / mx) * 80}%` }} />
                <span>{weeks.length > 8 ? Number(x.monday.slice(8)) : short(x.monday)}</span>
              </Link>
            ))}
          </div>
          <div style={{ height: 14 }} />
        </div>
      )}
      {m === "gewicht" && (
        <div className="card" style={{ paddingTop: 0 }}>
          <div className="field" style={{ borderTop: 0 }}>
            <label htmlFor="kg">Heute</label>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id="kg" className="inp num" inputMode="decimal" placeholder="–" value={kg} onChange={(e) => setKg(e.target.value)} />
              <span className="faint">kg</span>
            </span>
          </div>
          <button type="button" className="cta press" style={{ marginBottom: 12 }} disabled={!(w >= 20 && w <= 400) || put.isPending} onClick={() => put.mutate({ day: today, patch: { weightKg: Math.round(w * 10) / 10 } }, { onSuccess: () => setKg("") })}>Eintragen</button>
          <SaveNotice error={put.error} />
        </div>
      )}
    </Stage>
  );
}

/* ---------- Woche: die sieben Tage mit Schnitt ---------- */
function Woche({ m, monday }: { m: string; monday: string }) {
  const cfg = M[m]!;
  const today = useToday();
  const mon = mondayOf(monday);
  const days = weekDays(mon);
  const r = useRange(mon, days[6]!);
  const map = byDay(r.rows, cfg.key);
  const vals = days.map((d) => map.get(d) ?? null);
  const avg = avgOf(vals);
  const mx = Math.max(1, ...vals.map((v) => v ?? 0));
  const crumbs: Crumb[] = [{ label: cfg.title, href: `/koerper/${m}` }, { label: span(mon) }];
  return (
    <Stage title={cfg.title} back={`/koerper/${m}`} crumbs={crumbs}>
      <div className="center">
        {avg !== null ? <span className="bigv">{cfg.fmt(avg)}<small>{cfg.unit}</small></span> : <span className="bigv faint">–</span>}
        <span className="lbl">Schnitt {span(mon)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="iconbtn press" aria-label="Vorherige Woche" onClick={() => navigate(`/koerper/${m}/${addDays(mon, -7)}`, { replace: true })}><Icon n="back" /></button>
          <span className="chip">{span(mon)}</span>
          <button type="button" className="iconbtn press" aria-label="Nächste Woche" disabled={addDays(mon, 7) > today} onClick={() => navigate(`/koerper/${m}/${addDays(mon, 7)}`, { replace: true })}><Icon n="chev" /></button>
        </div>
      </div>
      {!r.ok ? <QueryNotice pending={r.pending} error={r.error} /> : (
        <div className="card">
          {days.map((d, i) => {
            const v = vals[i];
            const inner = (
              <>
                <span className="w"><b>{weekdayLong(d).slice(0, 2)} {dayCompact(d).split(" ").slice(1).join(" ")}</b><span><Meter pct={v === null ? 0 : (v / mx) * 100} /></span></span>
                <span className="a">{v === null ? <span className="faint">–</span> : <>{cfg.fmt(v)}<small>{cfg.unit}</small></>}{v !== null && <Icon n="chev" className="go" />}</span>
              </>
            );
            return v === null || d > today
              ? <div key={d} className="lrow nopic">{inner}</div>
              : <Link key={d} href={`/koerper/${m}/${mon}/${d}`} className="lrow nopic press">{inner}</Link>;
          })}
        </div>
      )}
    </Stage>
  );
}

/* ---------- Tag oder Nacht ---------- */
function Tag({ m, monday, day }: { m: string; monday: string; day: string }) {
  const cfg = M[m]!;
  const today = useToday();
  const from = addDays(day, -29);
  const r = useRange(from, day);
  const night = useNight(day);
  const map = byDay(r.rows, cfg.key);
  const v = map.get(day) ?? null;
  const others = [...map].filter(([d]) => d !== day).map(([, x]) => x);
  const avg = avgOf(others);
  const diff = v !== null ? diffPct(v, avg) : null;
  const n = night.data;
  const stages: [string, number | null][] = n ? [["Tief", n.deepMin], ["Leicht", n.lightMin], ["REM", n.remMin], ["Wach", n.awakeMin]] : [];
  const stageMax = Math.max(1, ...stages.map(([, x]) => x ?? 0));
  const mon = mondayOf(monday);
  return (
    <Stage title={`${cfg.day} ${dayCompact(day)}`} back={`/koerper/${m}/${mon}`} crumbs={[{ label: cfg.title, href: `/koerper/${m}` }, { label: span(mon), href: `/koerper/${m}/${mon}` }, { label: dayCompact(day) }]}>
      <div className="center">
        {v !== null ? <span className="bigv">{cfg.fmt(v)}<small>{cfg.unit}</small></span> : <span className="bigv faint">–</span>}
        <span className="lbl">{weekdayLong(day)}{day === today ? ", heute" : ""}</span>
      </div>
      {!r.ok ? <QueryNotice pending={r.pending} error={r.error} /> : (
        <div className="card" style={{ paddingTop: 0 }}>
          {avg !== null && <div className="kv"><span>Schnitt 30 Tage</span><span>{cfg.fmt(avg)}{cfg.unit}</span></div>}
          {diff !== null && <div className="kv"><span>Zum Schnitt</span><span className={Math.abs(diff) < 5 ? "" : (m === "ruhepuls" ? diff > 0 : diff < 0) ? "warn" : "good"}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{nf(Math.abs(diff), 0)} %</span></div>}
          {m === "schlaf" && n && <div className="kv"><span>Eingeschlafen</span><span>{clock(n.startAt)}</span></div>}
          {m === "schlaf" && n && <div className="kv"><span>Aufgewacht</span><span>{clock(n.endAt)}</span></div>}
          {m === "schlaf" && !n && night.isSuccess && <div className="kv"><span>Zeiten und Phasen</span><span className="faint">für diese Nacht nicht gespeichert</span></div>}
        </div>
      )}
      {m === "schlaf" && n && stages.some(([, x]) => x !== null) && (
        <div className="card">
          <h2>Phasen</h2>
          {stages.map(([k, x]) => x === null ? null : (
            <div key={k} className="lrow nopic"><span className="w"><b>{k}</b><span><Meter pct={(x / stageMax) * 100} /></span></span><span className="a">{hm(x)}</span></div>
          ))}
        </div>
      )}
    </Stage>
  );
}

/* ---------- Trainings: Woche, Training, Detail, gleiche Art ---------- */
function ViewPill() {
  const set = useSetSetting();
  const view = useSettings().workoutView === "alle" ? "alle" : "sport";
  return <div className="viewpill"><Segments full={false} label="Ansicht" value={view} onChange={(v) => set({ workoutView: v })} options={[{ v: "sport", label: "Sport" }, { v: "alle", label: "Alle" }]} /></div>;
}

function Trainings({ segs }: { segs: string[] }) {
  const today = useToday();
  const q = useWorkouts(addDays(today, -365), today);
  const view = useSettings().workoutView === "alle" ? "alle" : "sport";
  const all = [...(q.data ?? [])].sort((a, b) => b.startAt.localeCompare(a.startAt));
  const list = view === "sport" ? all.filter((w) => !isWalk(w)) : all;
  if (!q.isSuccess) return <Stage title="Trainings" back="/koerper"><QueryNotice pending={q.isPending} error={q.error} /></Stage>;
  const WorkoutRowLink = ({ w, base }: { w: WorkoutRow; base: string }) => (
    <Link href={`${base}/${encodeURIComponent(w.id)}`} className="lrow press">
      <span className="ic"><Icon n={workoutIcon(w)} /></span>
      <span className="w"><b>{workoutTitle(w)}</b><span>{dayCompact(w.day)} · {clock(w.startAt)}</span></span>
      <span className="a muted" style={{ fontSize: 14 }}>{w.minutes !== null ? fmtMin(w.minutes) : ""}<Icon n="chev" className="go" /></span>
    </Link>
  );
  // gleiche Art
  if (segs[1] === "art") {
    const type = decodeURIComponent(segs[2] ?? "");
    const same = all.filter((w) => w.type === type);
    if (segs[3]) return <Detail id={decodeURIComponent(segs[3])} all={all} parent={`/koerper/trainings/art/${encodeURIComponent(type)}`} crumbs={[{ label: "Trainings", href: "/koerper/trainings" }, { label: same[0] ? workoutTitle(same[0]) : "Art", href: `/koerper/trainings/art/${encodeURIComponent(type)}` }]} />;
    return (
      <Stage title={same[0] ? workoutTitle(same[0]) : "Art"} back="/koerper/trainings" crumbs={[{ label: "Trainings", href: "/koerper/trainings" }, { label: same[0] ? workoutTitle(same[0]) : "Art" }]}>
        <div className="center"><span className="bigv">{same.length}</span><span className="lbl">Trainings dieser Art</span></div>
        <div className="card">{same.length === 0 ? <div className="empty">Keine Trainings.</div> : same.map((w) => <WorkoutRowLink key={w.id} w={w} base={`/koerper/trainings/art/${encodeURIComponent(type)}`} />)}</div>
      </Stage>
    );
  }
  // Woche und Detail
  if (segs[1] === "woche" && segs[2]) {
    const mon = mondayOf(segs[2]);
    const rows = list.filter((w) => mondayOf(w.day) === mon);
    const base = `/koerper/trainings/woche/${mon}`;
    if (segs[3]) return <Detail id={decodeURIComponent(segs[3])} all={all} parent={base} crumbs={[{ label: "Trainings", href: "/koerper/trainings" }, { label: span(mon), href: base }]} />;
    const total = rows.reduce((a, w) => a + (w.minutes ?? 0), 0);
    return (
      <Stage title="Woche" back="/koerper/trainings" crumbs={[{ label: "Trainings", href: "/koerper/trainings" }, { label: span(mon) }]}>
        <div className="center"><span className="bigv">{rows.length}</span><span className="lbl">{rows.length === 1 ? "Training" : "Trainings"}{total ? ` · ${fmtMin(total)}` : ""}</span></div>
        <ViewPill />
        <div className="card">{rows.length === 0 ? <div className="empty">Kein Sport in dieser Woche.</div> : rows.map((w) => <WorkoutRowLink key={w.id} w={w} base={base} />)}</div>
      </Stage>
    );
  }
  if (segs[1]) return <Stage title="Trainings" back="/koerper/trainings"><NotFound /></Stage>;
  const weeks: { monday: string; rows: WorkoutRow[] }[] = [];
  for (const w of list) {
    const mon = mondayOf(w.day);
    const last = weeks.at(-1);
    last && last.monday === mon ? last.rows.push(w) : weeks.push({ monday: mon, rows: [w] });
  }
  return (
    <Stage title="Trainings" back="/koerper" crumbs={[{ label: "Trainings" }]}>
      <ViewPill />
      {weeks.length === 0 && <div className="card"><div className="empty">Kein Sport erkannt.</div></div>}
      {weeks.length > 0 && (
        <div className="card">
          {weeks.map((wk) => {
            const mins = wk.rows.reduce((a, w) => a + (w.minutes ?? 0), 0);
            return (
              <Link key={wk.monday} href={`/koerper/trainings/woche/${wk.monday}`} className="lrow nopic press">
                <span className="w"><b>{span(wk.monday)}</b><span>{wk.rows.length} {wk.rows.length === 1 ? "Training" : "Trainings"}{mins ? ` · ${fmtMin(mins)}` : ""}</span></span>
                <span className="a"><Icon n="chev" className="go" /></span>
              </Link>
            );
          })}
        </div>
      )}
    </Stage>
  );
}

function Detail({ id, all, parent, crumbs }: { id: string; all: WorkoutRow[]; parent: string; crumbs: Crumb[] }) {
  const w = all.find((x) => x.id === id);
  if (!w) return <Stage title="Training" back={parent}><NotFound /></Stage>;
  const same = all.filter((x) => x.type === w.type && x.id !== w.id);
  const cmp = (k: "minutes" | "kcal" | "avgHr", unit: string, fmt: (n: number) => string) => {
    const v = w[k];
    if (v === null) return null;
    const a = avgOf(same.map((x) => x[k]));
    return { v, a, unit, fmt };
  };
  const rows = [
    { label: "Dauer", c: cmp("minutes", "", fmtMin) },
    { label: "Kalorien", c: cmp("kcal", " kcal", (n) => nf(n)) },
    { label: "Puls", c: cmp("avgHr", " bpm", (n) => String(Math.round(n))) },
  ];
  return (
    <Stage title={workoutTitle(w)} back={parent} crumbs={[...crumbs, { label: dayCompact(w.day) }]}>
      <div className="center"><span className="bigv">{w.minutes !== null ? fmtMin(w.minutes) : "–"}</span><span className="lbl">{weekdayLong(w.day)}, {dayCompact(w.day)} · {clock(w.startAt)}{w.endAt ? ` bis ${clock(w.endAt)}` : ""}</span></div>
      <div className="card" style={{ paddingTop: 0 }}>
        {rows.map((x) => x.c && (
          <div key={x.label} className="kv" style={{ alignItems: "center" }}>
            <span>{x.label}</span>
            <span>{x.c.fmt(x.c.v)}{x.c.unit}{x.c.a !== null && <span className="faint" style={{ marginLeft: 8, fontSize: "var(--t-xs)" }}>Ø {x.c.fmt(Math.round(x.c.a))}</span>}</span>
          </div>
        ))}
        <div className="kv"><span>Quelle</span><span>Fitbit</span></div>
        {same.length > 0 && (
          <Link href={`/koerper/trainings/art/${encodeURIComponent(w.type)}`} className="kv press" style={{ alignItems: "center" }}>
            <span>Gleiche Art</span><span>{same.length + 1} Trainings <Icon n="chev" className="go" /></span>
          </Link>
        )}
      </div>
    </Stage>
  );
}
