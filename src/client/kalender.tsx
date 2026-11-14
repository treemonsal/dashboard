// Kalender-Termine (nur lesen) in Tagesplan und Woche, dazu das Blatt für einen Termin.
import { Fragment, useState, type ReactNode } from "react";
import { addDays, clockOf, dayCompact, minutesOf, mondayOf, weekdayNum } from "../shared/dates";
import { eventsOnDay, lastDayOf, type DayEvent } from "../shared/agenda";
import type { CalendarEvent, Exam, Task } from "../shared/schemas";
import { DetailHead, Icon } from "./ui";
import { useSheet } from "./sheet";
import { ExamSheet, TaskLine, TrainingSheet } from "./sheets";
import { useEvents, useExams, useGymDays, useGymPlans, useTasks, useToday } from "./queries";

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

interface Item {
  key: string;
  at: number;
  el: ReactNode;
}

/** Aufgaben, Termine und Prüfungen eines Tages in einer Reihenfolge: ganztägig, nach Uhrzeit, dann ohne Uhrzeit. */
export function dayItems(o: { day: string; tasks: Task[]; events: CalendarEvent[]; exams?: Exam[]; taskToday?: string }): ReactNode[] {
  const items: Item[] = [];
  for (const d of eventsOnDay(o.events, o.day)) {
    items.push({ key: `e:${d.event.id}`, at: d.allDay ? -2 : (d.startMin ?? 0), el: <EventRow d={d} day={o.day} /> });
  }
  for (const t of o.tasks) {
    const overdue = !!t.dueDate && t.dueDate < o.day;
    items.push({ key: `t:${t.id}`, at: overdue ? -1 : t.dueTime ? minutesOf(t.dueTime) : 9999, el: <TaskLine task={t} today={o.taskToday ?? o.day} showTime /> });
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
  const tasks = useTasks().data ?? [];
  const exams = useExams().data ?? [];
  const plans = useGymPlans().data ?? [];
  const gym = useGymDays(16);
  const ev = useEvents(from, addDays(from, 6));
  const sheet = useSheet();

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
      {days.map((day) => {
        const isToday = day === today;
        const dayTasks = tasks.filter((t) => !t.parentId && t.dueDate !== null && (isToday ? t.dueDate <= day && (!t.doneAt || t.dueDate === day || t.doneAt.slice(0, 10) >= day) : t.dueDate === day));
        const plan = plans.find((p) => p.weekdays.includes(weekdayNum(day)));
        const trainingDone = gym.done.has(day);
        const dayExams = exams.filter((x) => x.date === day);
        const items = dayItems({ day, tasks: dayTasks, events: ev.events, exams: dayExams });
        const training = (plan || trainingDone) && (
          <button type="button" className={`slot press ${trainingDone ? "done" : ""}`} onClick={() => sheet.open(<TrainingSheet day={day} />)}>
            <span className="t" />
            <span className="dot" style={{ background: trainingDone ? "var(--fg3)" : "var(--fg)" }} />
            <span className="w">
              <b>Gym</b>
              {plan && <span>{plan.name}</span>}
            </span>
            <span className="chkhit">
              <span className="chk">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2.5 6.8 5.3 9.5 10.5 3.8" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
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
            {empty ? (
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
