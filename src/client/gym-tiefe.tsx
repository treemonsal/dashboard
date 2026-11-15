// Gym in die Tiefe unter /ziele/gym: Raster (Wochen) -> Woche -> Tag mit Training -> Übung mit Verlauf über alle Trainings.
//   gym, gym/<montag>, gym/<montag>/<tag>, gym/<montag>/<tag>/<übung>
import { useQuery } from "@tanstack/react-query";
import { QueryNotice } from "./query-state";
import { Link } from "./router";
import { addDays, dayCompact, mondayOf, weekdayLong, weekdayNum } from "../shared/dates";
import { slug, weekDays } from "../shared/tiefe";
import { Icon, nf } from "./ui";
import { NotFound, Stage } from "./tiefe";
import { useSheet } from "./sheet";
import { TrainingSheet } from "./sheets";
import { api } from "./api";
import { useGymDay, useGymDays, useGymPlans, useSettings, useToday } from "./queries";
import type { GymSet } from "../shared/schemas";

const short = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`;
const span = (monday: string) => `${short(monday)}–${short(addDays(monday, 6))}`;

export function ZieleGym({ segs }: { segs: string[] }) {
  const monday = segs[1];
  if (!monday) return <Raster />;
  if (!/^\d{4}-\d\d-\d\d$/.test(monday)) return <Stage title="Gym" back="/ziele/gym"><NotFound /></Stage>;
  if (segs[3]) return <Uebung monday={monday} day={segs[2]!} slugName={segs[3]} />;
  if (segs[2]) return <Tag monday={monday} day={segs[2]} />;
  return <Woche monday={mondayOf(monday)} />;
}

function Raster() {
  const today = useToday();
  const goal = Number(useSettings().gymGoal);
  const gym = useGymDays(16);
  const mondays = Array.from({ length: 16 }, (_, i) => addDays(gym.from, i * 7)).reverse();
  return (
    <Stage title="Gym" back="/ziele" crumbs={[{ label: "Gym" }]}>
      <QueryNotice pending={gym.loading} error={gym.error} />
      <div className="card">
        <h2>Wochen <span>Ziel {goal}</span></h2>
        {mondays.map((m) => {
          const days = weekDays(m);
          const n = days.filter((d) => gym.done.has(d)).length;
          return (
            <Link key={m} href={`/ziele/gym/${m}`} className="lrow nopic press">
              <span className="w"><b>{span(m)}{m === mondayOf(today) ? " · diese Woche" : ""}</b><span className="wk" aria-hidden="true" style={{ marginTop: 6 }}>{days.map((d, r) => <i key={d} className={`${gym.done.has(d) ? "g" : ""} ${r === 6 ? "s" : ""}`} />)}</span></span>
              <span className="a">{n} von {goal}<Icon n="chev" className="go" /></span>
            </Link>
          );
        })}
      </div>
    </Stage>
  );
}

function Woche({ monday }: { monday: string }) {
  const today = useToday();
  const plans = useGymPlans().data ?? [];
  const gym = useGymDays(16);
  const days = weekDays(monday);
  const n = days.filter((d) => gym.done.has(d)).length;
  return (
    <Stage title="Woche" back="/ziele/gym" crumbs={[{ label: "Gym", href: "/ziele/gym" }, { label: span(monday) }]}>
      <div className="center"><span className="bigv">{n}</span><span className="lbl">Trainings in dieser Woche</span></div>
      <div className="card">
        {days.map((d) => {
          const plan = plans.find((p) => p.weekdays.includes(weekdayNum(d)));
          const done = gym.done.has(d);
          const missed = !done && !!plan && d < today;
          return (
            <Link key={d} href={`/ziele/gym/${monday}/${d}`} className="lrow nopic press">
              <span className="w"><b className={done ? "" : "muted"}>{weekdayLong(d).slice(0, 2)} {dayCompact(d).split(" ").slice(1).join(" ")}</b><span>{done ? "Training" : missed ? "verpasst" : plan ? plan.name : "frei"}</span></span>
              <span className="a"><i className="wk" aria-hidden="true"><i className={done ? "g" : ""} /></i><Icon n="chev" className="go" /></span>
            </Link>
          );
        })}
      </div>
    </Stage>
  );
}

function groupSets(sets: GymSet[]) {
  const groups: { name: string; sets: GymSet[] }[] = [];
  for (const x of sets) {
    const g = groups.find((y) => y.name === x.exerciseName);
    g ? g.sets.push(x) : groups.push({ name: x.exerciseName, sets: [x] });
  }
  return groups;
}

function Tag({ monday, day }: { monday: string; day: string }) {
  const sheet = useSheet();
  const q = useGymDay(day);
  const mon = mondayOf(monday);
  const crumbs = [{ label: "Gym", href: "/ziele/gym" }, { label: span(mon), href: `/ziele/gym/${mon}` }, { label: dayCompact(day) }];
  if (!q.data) return <Stage title="Training" back={`/ziele/gym/${mon}`} crumbs={crumbs}><QueryNotice pending={q.isPending} error={q.error} /></Stage>;
  const s = q.data.session;
  const groups = groupSets(s?.sets ?? []);
  const done = !!s?.finishedAt;
  const doneSets = (s?.sets ?? []).filter((x) => x.done).length;
  return (
    <Stage title={dayCompact(day)} back={`/ziele/gym/${mon}`} crumbs={crumbs}>
      <div className="center"><span className="bigv">{s?.planName ?? q.data.plan?.name ?? "Frei"}</span><span className="lbl">{weekdayLong(day)} · {done ? "abgeschlossen" : s ? "begonnen" : q.data.plan ? "geplant" : "kein Plan"}{s ? ` · ${doneSets} von ${s.sets.length} Sätzen` : ""}</span></div>
      <div className="card">
        <h2>Übungen</h2>
        {groups.length === 0 && <div className="empty">{s ? "Training ohne Übungen." : "Noch kein Training eingetragen."}</div>}
        {groups.map((g) => {
          const top = Math.max(0, ...g.sets.filter((x) => x.done).map((x) => x.weight ?? 0));
          return (
            <Link key={g.name} href={`/ziele/gym/${mon}/${day}/${slug(g.name)}`} className="lrow nopic press">
              <span className="w"><b>{g.name}</b><span>{g.sets.filter((x) => x.done).length} von {g.sets.length} Sätzen</span></span>
              <span className="a">{top > 0 ? `${nf(top, 1)} kg` : ""}<Icon n="chev" className="go" /></span>
            </Link>
          );
        })}
      </div>
      <button type="button" className="cta ghost press" style={{ marginTop: 0 }} onClick={() => sheet.open(<TrainingSheet day={day} />)}>{s ? "Training bearbeiten" : "Training eintragen"}</button>
    </Stage>
  );
}

function Uebung({ monday, day, slugName }: { monday: string; day: string; slugName: string }) {
  const q = useGymDay(day);
  const hist = useQuery({ queryKey: ["gym-history-all"], queryFn: api.gym.historyAll });
  const mon = mondayOf(monday);
  const parent = `/ziele/gym/${mon}/${day}`;
  if (!q.data || !hist.data) return <Stage title="Übung" back={parent}><QueryNotice pending={q.isPending || hist.isPending} error={q.error ?? hist.error} /></Stage>;
  const sets = (q.data.session?.sets ?? []).filter((x) => slug(x.exerciseName) === slugName).sort((a, b) => a.setIndex - b.setIndex);
  const name = sets[0]?.exerciseName ?? Object.keys(hist.data).find((k) => slug(k) === slugName);
  if (!name) return <Stage title="Übung" back={parent}><NotFound /></Stage>;
  const points = hist.data[name] ?? [];
  const best = Math.max(0, ...points.map((p) => p.weight));
  return (
    <Stage title={name} back={parent} crumbs={[{ label: "Gym", href: "/ziele/gym" }, { label: span(mon), href: `/ziele/gym/${mon}` }, { label: dayCompact(day), href: parent }, { label: name }]}>
      <div className="center"><span className="bigv">{best > 0 ? nf(best, 1) : "–"}<small>kg</small></span><span className="lbl">Bestwert über {points.length} {points.length === 1 ? "Training" : "Trainings"}</span></div>
      {points.length > 1 && <div className="card" style={{ paddingBottom: 14 }}><Verlauf values={points.map((p) => p.weight)} /></div>}
      <div className="card">
        <h2>{dayCompact(day)}</h2>
        {sets.length === 0 && <div className="empty">An diesem Tag nicht trainiert.</div>}
        {sets.map((x, i) => (
          <div key={x.id} className="lrow nopic"><span className={`w ${x.done ? "" : "faint"}`}><b>Satz {i + 1}</b><span>{x.done ? "erledigt" : "offen"}</span></span><span className="a">{x.reps} × {x.weight !== null ? `${nf(x.weight, 1)} kg` : "–"}</span></div>
        ))}
      </div>
      <div className="card">
        <h2>Verlauf</h2>
        {points.length === 0 && <div className="empty">Noch keine erledigten Sätze mit Gewicht.</div>}
        {[...points].reverse().map((p) => (
          <Link key={p.day} href={`/ziele/gym/${mondayOf(p.day)}/${p.day}/${slugName}`} className="lrow nopic press">
            <span className="w"><b>{dayCompact(p.day)}</b></span>
            <span className="a">{nf(p.weight, 1)} kg<Icon n="chev" className="go" /></span>
          </Link>
        ))}
      </div>
    </Stage>
  );
}

/** Linie der Bestwerte über alle Trainings. */
function Verlauf({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 300, 100 - 10 - ((v - min) / span) * 80] as const);
  return (
    <svg className="chart" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Verlauf des Bestwerts" style={{ height: 110, marginTop: 12 }}>
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")} vectorEffect="non-scaling-stroke" />
      <path className="dot" d={`M${pts.at(-1)![0]} ${pts.at(-1)![1]}h0`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
