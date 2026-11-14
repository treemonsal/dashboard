// Kalender-Termine (nur lesen) in Tagesplan und Woche, dazu das Blatt für einen Termin.
import { QueryNotice } from "./query-state";
import { Fragment, useState, type ReactNode } from "react";
import { addDays, clockOf, dayCompact, minutesOf, mondayOf, weekdayNum } from "../shared/dates";
import { eventsOnDay, lastDayOf, type DayEvent } from "../shared/agenda";
import type { CalendarEvent, Exam, Task } from "../shared/schemas";
import { CheckMark, DetailHead, Icon } from "./ui";
import type { LessonBlock } from "../shared/stundenplan";
import { useSheet } from "./sheet";
import { useSuggest } from "./suggest";
import type { Suggestion } from "../shared/vorschlag";
import { ExamSheet, TaskLine, TrainingSheet } from "./sheets";
import { useEvents, useExams, useGymDays, useGymPlans, useSubjects, useTasks, useTimetable, useToday } from "./queries";

/** Zeile eines Termins im Tagesplan: gedämpft, ohne Abhak-Kreis, antippbar. */
export function EventRow({ d, day }: { d: DayEvent; day: string }) {
  const sheet = useSheet();
  const e = d.event;
  const sub = [d.allDay ? "ganztägig" : d.endMin !== null && d.endMin !== d.startMin ? `bis ${clockOf(d.endMin)}` : "", e.location].filter(Boolean).join(" · ");
  return (
    <button type="button" className="slot event press" onClick={() => sheet.open(<EventSheet event={e} day={day} />)}>
      <span className="t">{d.startMin !== null ? clockOf(d.startMin) : ""}</span>
      <span className="dot" />
      <span className="w">
        <b>{e.title}</b>
        {sub && <span>{sub}</span>}
      </span>
      <span />
    </button>
  );
}

/** Zeile einer Lektion (Block) im Tagesplan: wie ein Termin gedämpft, ohne Abhak-Kreis. */
export function LessonRow({ b, day }: { b: LessonBlock; day: string }) {
  const sheet = useSheet();
  const name = useSubjects().data?.find((s) => s.code === b.subject)?.name;
  const sub = [`bis ${clockOf(b.endMin)}`, b.room].filter(Boolean).join(" · ");
  return (
    <button type="button" className="slot event lesson press" onClick={() => sheet.open(<LessonSheet b={b} name={name ?? null} day={day} />)}>
      <span className="t">{clockOf(b.startMin)}</span>
      <span className="dot" />
      <span className="w">
        <b>{b.subject}</b>
        <span>{sub}</span>
      </span>
      <span />
    </button>
  );
}

export function LessonSheet({ b, name, day }: { b: LessonBlock; name: string | null; day: string }) {
  return (
    <div>
      <h3>{name ? `${name} (${b.subject})` : b.subject}</h3>
      <div className="when">{dayCompact(day)}, {clockOf(b.startMin)}–{clockOf(b.endMin)}</div>
      {b.room && <div className="field"><span>Zimmer</span><span>{b.room}</span></div>}
      {b.teacher && <div className="field"><span>Lehrperson</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{b.teacher}</span></div>}
      {b.lessons > 1 && <div className="legend" style={{ marginTop: 16 }}>{b.lessons} Lektionen</div>}
    </div>
  );
}

interface Item {
  key: string;
  at: number;
  el: ReactNode;
}

/** Aufgaben, Termine und Prüfungen eines Tages in einer Reihenfolge: ganztägig, nach Uhrzeit, dann ohne Uhrzeit. */
export function dayItems(o: { day: string; tasks: Task[]; events: CalendarEvent[]; exams?: Exam[]; taskToday?: string; suggest?: Map<string, Suggestion>; lessons?: LessonBlock[] }): ReactNode[] {
  const items: Item[] = [];
  for (const b of o.lessons ?? []) items.push({ key: `l:${b.startMin}:${b.subject}`, at: b.startMin, el: <LessonRow b={b} day={o.day} /> });
  for (const d of eventsOnDay(o.events, o.day)) {
    items.push({ key: `e:${d.event.id}`, at: d.allDay ? -2 : (d.startMin ?? 0), el: <EventRow d={d} day={o.day} /> });
  }
  for (const t of o.tasks) {
    const overdue = !!t.dueDate && t.dueDate < o.day;
    items.push({ key: `t:${t.id}`, at: overdue ? -1 : t.dueTime ? minutesOf(t.dueTime) : o.suggest?.get(t.id) ? minutesOf(o.suggest.get(t.id)!.time) : 9999, el: <TaskLine task={t} today={o.taskToday ?? o.day} showTime suggest={o.suggest?.get(t.id)} /> });
  }
  for (const x of o.exams ?? []) {
    items.push({ key: `x:${x.id}`, at: x.startTime ? minutesOf(x.startTime) : -1, el: <ExamRow exam={x} /> });
  }
  return items.sort((a, b) => a.at - b.at).map((i) => <Fragment key={i.key}>{i.el}</Fragment>);
}

function ExamRow({ exam }: { exam: Exam }) {
  const sheet = useSheet();
  return (
    <button type="button" className="slot press" onClick={() => sheet.open(<ExamSheet id={exam.id} />)}>
      <span className="t">{exam.startTime ?? ""}</span>
      <span className="dot" style={{ background: "var(--fg)" }} />
      <span className="w">
        <b>Prüfung {exam.subjectCode}</b>
        {exam.room && <span>{exam.room}</span>}
      </span>
      <span />
    </button>
  );
}

const URL_RE = /(https:\/\/[^\s<>"]+)/g;
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
            {p.length > 48 ? `${p.slice(0, 45)}…` : p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function EventSheet({ event: e, day }: { event: CalendarEvent; day: string }) {
  const last = lastDayOf(e);
  const first = e.startDate;
  const time = e.allDay ? "ganztägig" : e.endTime && e.endTime !== e.startTime ? `${e.startTime}–${e.endTime}` : e.startTime;
  const dates = last > first ? `${dayCompact(first)} bis ${dayCompact(last)}` : dayCompact(first);
  return (
    <div>
      <h3>{e.title}</h3>
      <div className="when">{[dates, time].filter(Boolean).join(", ")}</div>
      {e.location && (
        <div className="field">
          <span>Ort</span>
          <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{e.location}</span>
        </div>
      )}
      {e.description && (
        <>
          <div className="sec">Beschreibung</div>
          <p style={{ margin: "0 0 4px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--fg2)", lineHeight: 1.4 }}>
            <Linked text={e.description} />
          </p>
        </>
      )}
      <div className="legend" style={{ marginTop: 16 }}>{e.calendarName}</div>
      <span hidden>{day}</span>
    </div>
  );
}

/* ---------- Woche ---------- */
const range = (from: string) => {
  const to = addDays(from, 6);
  const a = dayCompact(from).split(" ");
  const b = dayCompact(to).split(" ");
  return a[2] === b[2] ? `${a[1]}–${b[1]} ${b[2]}` : `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
};

export function Woche() {
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const from = addDays(mondayOf(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const tasksQuery = useTasks();
  const tasks = tasksQuery.data ?? [];
  const examsQuery = useExams();
  const exams = examsQuery.data ?? [];
  const plansQuery = useGymPlans();
  const plans = plansQuery.data ?? [];
  const gym = useGymDays(16);
  const ev = useEvents(from, addDays(from, 6));
  const sheet = useSheet();
  const suggest = useSuggest();
  const tt = useTimetable();

  const loading = tasksQuery.isPending || examsQuery.isPending || plansQuery.isPending || gym.loading || ev.loading || tt.loading;
  const error = tasksQuery.error ?? examsQuery.error ?? plansQuery.error ?? gym.error ?? ev.error ?? tt.error;
  return (
    <div className="view">
      <DetailHead title="Woche" back="/" />
      <div className="wknav">
        <button type="button" className="iconbtn press" aria-label="Vorherige Woche" onClick={() => setOffset(offset - 1)}>
          <Icon n="back" />
        </button>
        <button type="button" className="press wkl" onClick={() => setOffset(0)} aria-label="Zur aktuellen Woche">
          {range(from)}
          {offset !== 0 && <span className="faint"> · heute</span>}
        </button>
        <button type="button" className="iconbtn press" aria-label="Nächste Woche" onClick={() => setOffset(offset + 1)}>
          <Icon n="chev" />
        </button>
      </div>
      <QueryNotice pending={loading} error={error} />
      {days.map((day) => {
        const isToday = day === today;
        const dayTasks = tasks.filter((t) => !t.parentId && t.dueDate !== null && (isToday ? t.dueDate <= day && (!t.doneAt || t.dueDate === day || t.doneAt.slice(0, 10) >= day) : t.dueDate === day));
        const plan = plans.find((p) => p.weekdays.includes(weekdayNum(day)));
        const trainingDone = gym.done.has(day);
        const dayExams = exams.filter((x) => x.date === day);
        const items = dayItems({ day, tasks: dayTasks, events: ev.events, exams: dayExams, lessons: tt.on(day), suggest: suggest(day, dayTasks, ev.events, today) });
        const missed = gym.loaded && !!plan && !trainingDone && day < today;
        const training = (plan || trainingDone) && (
          <button type="button" className={`slot press ${trainingDone ? "done" : ""} ${missed ? "missed" : ""}`} onClick={() => sheet.open(<TrainingSheet day={day} />)}>
            <span className="t" />
            <span className="dot" style={missed ? undefined : { background: trainingDone ? "var(--fg3)" : "var(--fg)" }} />
            <span className="w">
              <b>Gym</b>
              {plan && <span>{plan.name}</span>}
            </span>
            <span className="chkhit">
              <span className="chk"><CheckMark /></span>
            </span>
          </button>
        );
        const empty = items.length === 0 && !training;
        return (
          <div key={day} className={`card wkday ${isToday ? "today" : ""} ${day < today ? "past" : ""}`} data-day={day}>
            <h2>
              <span className="wkd">{dayCompact(day)}</span>
              {isToday && <span>heute</span>}
            </h2>
            {empty && (loading || error) ? null : empty ? (
              <div className="wkempty">–</div>
            ) : (
              <div className="tl">
                {items}
                {training}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
