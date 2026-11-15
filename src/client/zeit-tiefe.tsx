// Zeit in die Tiefe unter /zeit/<jahr>/<monat>[/<tag>]: Jahr (die Seite /zeit) -> Monat -> Tag mit allem, was an diesem Tag war.
import { useQuery } from "@tanstack/react-query";
import { QueryNotice } from "./query-state";
import { Link, navigate } from "./router";
import { addDays, dayCompact, monthLong, mondayOf, weekdayLong, weekdayNum } from "../shared/dates";
import { spendSum } from "../shared/tiefe";
import { CheckMark, Icon, Money, hm, nf } from "./ui";
import { NotFound, Stage } from "./tiefe";
import { dayItems } from "./kalender";
import { useSuggest } from "./suggest";
import { api } from "./api";
import { keys, useAllTransactions, useEvents, useExams, useGymDay, useGymPlans, useTasks, useTimetable, useToday } from "./queries";
import { useWorkouts, workoutTitle, fmtMin } from "./trainings";

const pad = (n: number) => String(n).padStart(2, "0");
export const zeitDay = (d: string) => `/zeit/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`;
export const zeitMonth = (y: number, m: number) => `/zeit/${y}/${pad(m)}`;

export function ZeitTiefe({ path }: { path: string }) {
  const [, y, m, d] = path.split("/").filter(Boolean);
  const year = Number(y), month = Number(m);
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return <Stage title="Zeit" back="/zeit"><NotFound /></Stage>;
  if (d) {
    const date = `${y}-${pad(month)}-${pad(Number(d))}`;
    if (Number.isNaN(Date.parse(date)) || date.slice(0, 7) !== `${y}-${pad(month)}`) return <Stage title="Zeit" back="/zeit"><NotFound /></Stage>;
    return <Tag date={date} />;
  }
  return <Monat year={year} month={month} />;
}

function Monat({ year, month }: { year: number; month: number }) {
  const today = useToday();
  const first = `${year}-${pad(month)}-01`;
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${pad(month)}-${pad(n)}`;
  const off = (weekdayNum(first) + 6) % 7;
  const tasks = useTasks().data ?? [];
  const exams = useExams().data ?? [];
  const ev = useEvents(first, last);
  const gym = useQuery({ queryKey: keys.gymDays(first), queryFn: () => api.gym.days(first, addDays(last, 1)) });
  const done = new Set((gym.data ?? []).filter((x) => x.finished).map((x) => x.day));
  const taskDays = new Set(tasks.filter((t) => !t.parentId && t.dueDate).map((t) => t.dueDate!));
  const examDays = new Set(exams.map((e) => e.date));
  const evDays = new Set(ev.events.flatMap((e) => { const out: string[] = []; for (let d = e.startDate; d <= (e.endDate || e.startDate) && out.length < 32; d = addDays(d, 1)) out.push(d); return out; }));
  const shift = (k: number) => { const dt = new Date(Date.UTC(year, month - 1 + k, 1)); navigate(zeitMonth(dt.getUTCFullYear(), dt.getUTCMonth() + 1), { replace: true }); };
  const nTasks = [...taskDays].filter((d) => d >= first && d <= last).length;
  return (
    <Stage title={monthLong(month)} back="/zeit" crumbs={[{ label: String(year), href: "/zeit" }, { label: monthLong(month) }]}>
      <div className="center">
        <span className="bigv" style={{ fontSize: "var(--t-xl)" }}>{monthLong(month)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="iconbtn press" aria-label="Voriger Monat" onClick={() => shift(-1)}><Icon n="back" /></button>
          <span className="chip">{year}</span>
          <button type="button" className="iconbtn press" aria-label="Nächster Monat" onClick={() => shift(1)}><Icon n="chev" /></button>
        </div>
      </div>
      <QueryNotice pending={ev.loading} error={ev.error} />
      <div className="card">
        <div className="calh" aria-hidden="true">{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((x) => <span key={x}>{x}</span>)}</div>
        <div className="cal">
          {Array.from({ length: off }, (_, i) => <span key={`o${i}`} />)}
          {Array.from({ length: n }, (_, i) => {
            const d = `${year}-${pad(month)}-${pad(i + 1)}`;
            const cls = [d === today ? "now" : "", done.has(d) ? "g" : "", examDays.has(d) ? "x" : "", d < today ? "p" : ""].join(" ");
            return (
              <Link key={d} href={zeitDay(d)} className={`press ${cls}`} aria-label={`${dayCompact(d)}${done.has(d) ? ", Training" : ""}${examDays.has(d) ? ", Prüfung" : ""}`}>
                <b>{i + 1}</b>
                <span className="mk">{taskDays.has(d) && <i />}{evDays.has(d) && <i className="o" />}</span>
              </Link>
            );
          })}
        </div>
        <div className="legend" style={{ margin: "10px 0 12px" }}>{nTasks} Tage mit Aufgaben · weiss: Training · Strich: Prüfung</div>
      </div>
    </Stage>
  );
}

function Tag({ date }: { date: string }) {
  const today = useToday();
  const y = date.slice(0, 4), mo = Number(date.slice(5, 7));
  const tasksQ = useTasks();
  const tasks = tasksQ.data ?? [];
  const exams = (useExams().data ?? []).filter((e) => e.date === date);
  const ev = useEvents(date, date);
  const tt = useTimetable();
  const suggest = useSuggest();
  const plans = useGymPlans().data ?? [];
  const gym = useGymDay(date);
  const health = useQuery({ queryKey: keys.health(date, date), queryFn: () => api.health.list(date, date) });
  const workouts = useWorkouts(date, date);
  const txs = (useAllTransactions().data ?? []).filter((t) => t.date === date);
  const isToday = date === today;
  const dayTasks = tasks.filter((t) => !t.parentId && t.dueDate !== null && (isToday ? t.dueDate <= date && (!t.doneAt || t.dueDate === date || t.doneAt.slice(0, 10) >= date) : t.dueDate === date));
  const items = dayItems({ day: date, tasks: dayTasks, events: ev.events, exams, lessons: tt.on(date), suggest: suggest(date, dayTasks, ev.events, today) });
  const plan = plans.find((p) => p.weekdays.includes(weekdayNum(date)));
  const session = gym.data?.session;
  const trained = !!session?.finishedAt;
  const h = health.data?.[0];
  const sport = (workouts.data ?? []).filter((w) => !/^WALK/i.test(w.type));
  const spend = spendSum(txs);
  const mon = mondayOf(date);
  const rows: { k: string; v: string; href: string }[] = [];
  if (plan || session) rows.push({ k: "Gym", v: trained ? "Training" : session ? "begonnen" : (plan?.name ?? ""), href: `/ziele/gym/${mon}/${date}` });
  if (h?.sleepMin != null) rows.push({ k: "Schlaf", v: hm(h.sleepMin), href: `/koerper/schlaf/${mon}/${date}` });
  if (h?.steps != null) rows.push({ k: "Schritte", v: nf(h.steps), href: `/koerper/schritte/${mon}/${date}` });
  if (h?.restingHr != null) rows.push({ k: "Ruhepuls", v: `${h.restingHr} bpm`, href: `/koerper/ruhepuls/${mon}/${date}` });
  if (h?.weightKg != null) rows.push({ k: "Gewicht", v: `${nf(h.weightKg, 1)} kg`, href: `/koerper/gewicht/${mon}/${date}` });
  const shift = (k: number) => navigate(zeitDay(addDays(date, k)), { replace: true });
  const loading = tasksQ.isPending || ev.loading || tt.loading;
  return (
    <Stage title={dayCompact(date)} back={zeitMonth(Number(y), mo)} crumbs={[{ label: y, href: "/zeit" }, { label: monthLong(mo), href: zeitMonth(Number(y), mo) }, { label: dayCompact(date) }]}>
      <div className="center">
        <span className="lbl" style={{ fontSize: "var(--t-md)" }}>{weekdayLong(date)}{isToday ? ", heute" : ""}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="iconbtn press" aria-label="Vorheriger Tag" onClick={() => shift(-1)}><Icon n="back" /></button>
          <span className="chip">{dayCompact(date)}</span>
          <button type="button" className="iconbtn press" aria-label="Nächster Tag" onClick={() => shift(1)}><Icon n="chev" /></button>
        </div>
      </div>
      <div className="card">
        <h2>Plan</h2>
        <QueryNotice pending={loading} error={tasksQ.error ?? ev.error ?? tt.error} />
        {!loading && items.length === 0 && !(plan || session) && <div className="empty">Nichts an diesem Tag.</div>}
        <div className="tl">
          {items}
          {(plan || session) && (
            <Link href={`/ziele/gym/${mon}/${date}`} className={`slot press ${trained ? "done" : ""}`}>
              <span className="t" />
              <span className="dot" style={{ background: trained ? "var(--fg3)" : "var(--fg)" }} />
              <span className="w"><b>Gym</b>{(session?.planName ?? plan?.name) && <span>{session?.planName ?? plan?.name}</span>}</span>
              <span className="chkhit"><span className="chk"><CheckMark /></span></span>
            </Link>
          )}
        </div>
      </div>
      {(rows.length > 0 || sport.length > 0 || txs.length > 0) && (
        <div className="card">
          <h2>Daten</h2>
          {rows.map((r) => (
            <Link key={r.k} href={r.href} className="lrow nopic press"><span className="w"><b>{r.k}</b></span><span className="a">{r.v}<Icon n="chev" className="go" /></span></Link>
          ))}
          {sport.map((w) => (
            <Link key={w.id} href={`/koerper/trainings/woche/${mon}/${encodeURIComponent(w.id)}`} className="lrow nopic press"><span className="w"><b>{workoutTitle(w)}</b></span><span className="a">{w.minutes !== null ? fmtMin(w.minutes) : ""}<Icon n="chev" className="go" /></span></Link>
          ))}
          {txs.length > 0 && (
            <Link href={`/geld/tag/${date}`} className="lrow nopic press"><span className="w"><b>Ausgaben</b><span>{txs.length} Buchungen</span></span><span className="a"><Money v={spend} size={17} cur={false} /><Icon n="chev" className="go" /></span></Link>
          )}
        </div>
      )}
    </Stage>
  );
}
