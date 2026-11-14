import { useState, type FormEvent } from "react";
import { dayMonthLong, daysUntil, numberWord, weekdayLong, dayCompact, minutesOf } from "../shared/dates";
import { parseQuick } from "../shared/parse";
import { describeRule } from "../shared/recurrence";
import { Link } from "./router";
import { useSheet } from "./sheet";
import { Check, ExamSheet, TagSheet, TaskLine, TrainingSheet } from "./sheets";
import { GeldSheet, HealthSheet } from "./sheets2";
import { CheckMark, Icon, Money, Ring, Meter, Empty, nf, hm } from "./ui";
import { useDay } from "./day";
import { ExamsCard, GymCard, NotenCard, YearCard } from "./cards";
import { inbox, upcoming as upcomingTasks, tasksToday, useLatest, useMonthMoney } from "./lib";
import { dayItems } from "./kalender";
import { useCreateProject, useCreateTask, useEvents, useExams, useHealth, useProjects, useSettings, useTasks, useToday } from "./queries";

export function Heute() {
  const d = useDay();
  const sheet = useSheet();
  const s = useSettings();
  const exams = useExams().data ?? [];
  const money = useMonthMoney();
  const sleep = useLatest("sleepMin");
  const steps = useLatest("steps");
  const h7 = useHealth(7);
  const dayEvents = useEvents(d.today, d.today);
  const remaining = d.total - d.done;
  const timed = d.list.filter((t) => t.dueTime);
  const untimed = d.list.filter((t) => !t.dueTime);
  const nextTask = [...timed, ...untimed].find((t) => !t.doneAt);
  const nextText = nextTask ? `Als Nächstes: ${nextTask.title}${nextTask.dueTime ? ` um ${nextTask.dueTime}` : ""}` : d.training && !d.training.done ? "Als Nächstes: Gym" : "";
  const title = d.total === 0 ? "Nichts geplant" : remaining === 0 ? "Alles erledigt" : remaining === 1 ? "Noch ein Ding" : `Noch ${numberWord(remaining)} Dinge`;
  const next = exams[0];
  const mx = Math.max(1, ...h7.rows.map((r) => r.sleepMin ?? 0));
  const sleepToday = sleep.latest;
  const stepsToday = steps.latest;
  const trainingRow = d.training && (
    <button type="button" className={`slot press ${d.training.done ? "done" : ""}`} onClick={() => sheet.open(<TrainingSheet day={d.today} />)}>
      <span className="t" />
      <span className="dot" style={{ background: d.training.done ? "var(--fg3)" : "var(--fg)" }} />
      <span className="w">
        <b>Gym</b>
        <span>{d.training.name !== "Training" ? d.training.name : ""}</span>
      </span>
      <span className="chkhit"><span className="chk"><CheckMark /></span></span>
    </button>
  );
  return (
    <div className="view">
      <div className="top">
        <Link href="/woche" className="d press" aria-label="Woche öffnen">{weekdayLong(d.today)}, {dayMonthLong(d.today)}</Link>
        <Link href="/einstellungen" className="iconbtn press" aria-label="Einstellungen">
          <Icon n="gear" />
        </Link>
      </div>

      <div>
        <button type="button" className="hero press" onClick={() => sheet.open(<TagSheet />)} aria-label="Heute öffnen">
          <Ring done={d.done} total={d.total} />
          <span style={{ minWidth: 0 }}>
            <h1>{title}</h1>
            {nextText && <p>{nextText}</p>}
          </span>
        </button>
        {d.total === 0 && !d.loading && <Link href="/aufgaben" className="chip btn press" style={{ marginLeft: 4 }}>Aufgabe hinzufügen</Link>}
      </div>

      <YearCard />

      <div className="tiles">
        <button type="button" className="tile press" onClick={() => sheet.open(<GeldSheet />)}>
          <span className="k">Übrig</span>
          {money.summary.hasData ? (
            <>
              <span className="v"><Money v={money.summary.left} size={26} /></span>
              <Meter pct={money.budget ? (money.summary.spent / money.budget) * 100 : 0} />
            </>
          ) : (
            <span className="v none">–</span>
          )}
        </button>
        <button type="button" className="tile press" onClick={() => sheet.open(<HealthSheet metric="sleep" />)}>
          <span className="k">Schlaf</span>
          {sleepToday?.sleepMin != null ? (
            <>
              <span className="v">{Math.floor(sleepToday.sleepMin / 60)}<small>h</small> {String(sleepToday.sleepMin % 60).padStart(2, "0")}<small>m</small></span>
              <span className="bars">{h7.rows.slice(-7).map((r) => (<i key={r.day} className={r.day === sleepToday.day ? "on" : ""} style={{ height: `${Math.round(((r.sleepMin ?? 0) / mx) * 100)}%` }} />))}</span>
            </>
          ) : (
            <span className="v none">–</span>
          )}
        </button>
        <button type="button" className="tile press" onClick={() => sheet.open(<HealthSheet metric="steps" />)}>
          <span className="k">Schritte</span>
          {stepsToday?.steps != null ? (
            <>
              <span className="v">{nf(stepsToday.steps)}</span>
              <Meter pct={(stepsToday.steps / 10000) * 100} />
            </>
          ) : (
            <span className="v none">–</span>
          )}
        </button>
        {next && (
          <button type="button" className="tile press" onClick={() => sheet.open(<ExamSheet id={next.id} />)}>
            <span className="k">Prüfung</span>
            <span className={`v ${daysUntil(next.date) < 15 ? "warn" : ""}`}>{daysUntil(next.date)}<small>Tage</small></span>
            <span className="k">{next.subjectCode}</span>
          </button>
        )}
      </div>

      <div className="card">
        <h2>Dein Tag</h2>
        <div className="tl">
          {dayItems({ day: d.today, tasks: d.list, events: dayEvents.events })}
          {trainingRow}
          <div className="slot pinned">
            <span className="t">{s.sleepTime}</span>
            <span className="dot" style={{ background: "var(--fg3)" }} />
            <span className="w"><b>Schlafen</b></span>
            <span className="chkhit"><span className="chk" /></span>
          </div>
        </div>
      </div>

      <GymCard />
      <ExamsCard />
      <span hidden>{dayCompact(d.today)}{minutesOf("00:00")}{hm(0)}</span>
    </div>
  );
}

/* ---------- Aufgaben ---------- */
type Seg = "eingang" | "heute" | "demnaechst" | "projekte";

export function Aufgaben() {
  const today = useToday();
  const tasks = useTasks();
  const projects = useProjects().data ?? [];
  const create = useCreateTask();
  const createProject = useCreateProject();
  const [seg, setSeg] = useState<Seg>("heute");
  const [text, setText] = useState("");
  const [pName, setPName] = useState("");
  const [openProject, setOpenProject] = useState<string | null>(null);
  const all = tasks.data ?? [];
  const lists = { eingang: inbox(all), heute: tasksToday(all, today), demnaechst: upcomingTasks(all, today) };
  const parsed = text.trim() ? parseQuick(text, today) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed || !parsed.title) return;
    create.mutate({
      id: crypto.randomUUID(),
      title: parsed.title,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      durationMin: parsed.durationMin,
      recurrence: parsed.recurrence,
      projectId: seg === "projekte" ? openProject : null,
    });
    setText("");
    if (seg !== "projekte" || !openProject) setSeg(parsed.dueDate ? (parsed.dueDate <= today ? "heute" : "demnaechst") : "eingang");
  }

  const groups: [string, typeof all][] = [];
  for (const t of lists.demnaechst) {
    const g = groups.find((x) => x[0] === t.dueDate);
    g ? g[1].push(t) : groups.push([t.dueDate!, [t]]);
  }
  const chips = parsed ? [parsed.dueDate && (parsed.dueDate === today ? "heute" : dayCompact(parsed.dueDate)), parsed.dueTime, parsed.durationMin && `${parsed.durationMin} min`, parsed.recurrence && describeRule(parsed.recurrence)].filter(Boolean) : [];

  return (
    <div className="view">
      <div className="top"><span className="d" style={{ fontSize: 28, fontWeight: 700, color: "var(--fg)", letterSpacing: "-.03em" }}>Aufgaben</span></div>
      <div className="seg full" role="group" aria-label="Ansicht">
        {([["eingang", "Eingang", lists.eingang.length], ["heute", "Heute", lists.heute.filter((t) => !t.doneAt).length], ["demnaechst", "Demnächst", lists.demnaechst.length], ["projekte", "Projekte", 0]] as [Seg, string, number][]).map(([k, l, n]) => (
          <button key={k} type="button" className="press" aria-pressed={seg === k} onClick={() => setSeg(k)} style={{ padding: "0 4px" }}>
            {l}{n > 0 && <span className="faint" style={{ marginLeft: 4, fontSize: 12 }}>{n}</span>}
          </button>
        ))}
      </div>

      {seg !== "demnaechst" && seg !== "projekte" && (
        <div className="card" style={{ paddingTop: 0 }}>
          {lists[seg].length === 0 ? <div className="empty">{seg === "eingang" ? "Nichts im Eingang." : "Nichts für heute."}</div> : lists[seg].map((t) => (<TaskLine key={t.id} task={t} today={today} />))}
        </div>
      )}
      {seg === "demnaechst" && (groups.length === 0 ? <div className="card"><div className="empty">Nichts geplant.</div></div> : groups.map(([date, list]) => (
        <div key={date} className="card" style={{ paddingTop: 0 }}>
          <h2>{dayCompact(date)}</h2>
          {list.map((t) => (<TaskLine key={t.id} task={t} today={today} />))}
        </div>
      )))}
      {seg === "projekte" && (
        <>
          {projects.map((p) => {
            const list = all.filter((t) => t.projectId === p.id && !t.parentId && !t.doneAt);
            const open = openProject === p.id;
            return (
              <div key={p.id} className="card" style={{ paddingTop: 0 }}>
                <button type="button" className="row press" aria-expanded={open} onClick={() => setOpenProject(open ? null : p.id)}>
                  <div className="l"><b>{p.name}</b></div>
                  <span className="r">{list.length}</span>
                </button>
                {open && (list.length === 0 ? <div className="empty">Noch keine Aufgabe. Unten eintippen.</div> : list.map((t) => (<TaskLine key={t.id} task={t} today={today} />)))}
              </div>
            );
          })}
          <form className="card" style={{ display: "flex", gap: 8, padding: 8 }} onSubmit={(e) => { e.preventDefault(); const n = pName.trim(); if (n) { createProject.mutate({ id: crypto.randomUUID(), name: n }); setPName(""); } }}>
            <input className="inp grow" style={{ background: "none" }} placeholder="Neues Projekt" value={pName} onChange={(e) => setPName(e.target.value)} maxLength={120} aria-label="Neues Projekt" />
          </form>
        </>
      )}

      <div className="qe">
        {chips.length > 0 && <div className="chips">{chips.map((c) => (<span key={String(c)}>{c}</span>))}</div>}
        <form onSubmit={submit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={seg === "projekte" && openProject ? "Neue Aufgabe im Projekt" : "Neue Aufgabe"} maxLength={500} aria-label="Neue Aufgabe" enterKeyHint="send" />
          <button type="submit" className="press" disabled={!parsed?.title} aria-label="Hinzufügen"><Icon n="up" /></button>
        </form>
      </div>
      <span hidden><Check done={false} onToggle={() => {}} label="" /><Empty>{""}</Empty></span>
    </div>
  );
}

export function Ziele() {
  return (
    <div className="view">
      <div className="top"><span className="d" style={{ fontSize: 28, fontWeight: 700, color: "var(--fg)", letterSpacing: "-.03em" }}>Ziele</span></div>
      <GymCard />
      <NotenCard />
      <ExamsCard limit={6} />
      <YearCard />
    </div>
  );
}
