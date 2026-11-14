// Inhalte der Blätter (zweite Ebene).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, dayCompact, daysUntil, inDays, todayInZone, weekdayNum, WEEKDAY_LETTERS, WEEK_ORDER } from "../shared/dates";
import { neededGrade } from "../shared/calc";
import { buildRule, describeRule, parseRepeat } from "../shared/recurrence";
import type { GymPlan, GymSet, Task } from "../shared/schemas";
import { useSheet } from "./sheet";
import { navigate } from "./router";
import { CheckMark, ConfirmDelete, DayToggles, Icon, Segments, Spark, nf } from "./ui";
import { SwipeRow } from "./swipe";
import { useDay } from "./day";
import { FitbitHinweis } from "./fitbit-setup";
import type { Suggestion } from "../shared/vorschlag";
import { subjectAverages } from "./lib";
import {
  useAddGrade, useAddTopic, useCreateTask, useDeleteGrade, useDeletePlan, useDeleteTask, useExam, useFinishSession, useGrades, useGymDay, useGymHistory,
  useGymPlans, usePlanStudy, useProjects, useRemoveSession, useSavePlan, useSetAssessment, useStartSession, useSubjects, useTasks, useToday, useToggleTask,
  useUpdateSet, useUpdateTask,
} from "./queries";

const uid = () => crypto.randomUUID();
const num = (s: string) => {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/* ---------- Aufgabe ---------- */
export function Check({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={`chkhit press ${done ? "done" : ""}`} data-noswipe aria-pressed={done} aria-label={label} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <span className="chk">
        <CheckMark />
      </span>
    </button>
  );
}

function taskMeta(t: Task, today: string): { text: string; warn: boolean } {
  const parts: string[] = [];
  let warn = false;
  if (t.dueDate && t.dueDate < today && !t.doneAt) {
    parts.push(dayCompact(t.dueDate));
    warn = true;
  } else if (t.dueDate && t.dueDate > today) parts.push(dayCompact(t.dueDate));
  if (t.dueTime && !(t.dueDate === today)) parts.push(t.dueTime);
  if (t.durationMin) parts.push(`${t.durationMin} min`);
  if (t.recurrence) parts.push(describeRule(t.recurrence));
  return { text: parts.join(" · "), warn };
}

/** Zeile einer Aufgabe, wischbar (nach links = erledigt), antippbar (Blatt), Kreis rechts hakt ab. */
export function TaskLine({ task, today, showTime = false, suggest }: { task: Task; today: string; showTime?: boolean; suggest?: Suggestion }) {
  const toggle = useToggleTask();
  const upd = useUpdateTask();
  const sheet = useSheet();
  const done = !!task.doneAt;
  const m = taskMeta(task, today);
  return (
    <SwipeRow disabled={done} onComplete={() => toggle.mutate(task.id, true)} onTap={() => sheet.open(<TaskSheet id={task.id} />)}>
      <div className={`slot press ${showTime ? "" : "nl"} ${done ? "done" : ""}`} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && sheet.open(<TaskSheet id={task.id} />)} style={showTime ? undefined : { gridTemplateColumns: "minmax(0,1fr) var(--hit)" }}>
        {showTime && (
          <span className="t">
            {task.dueTime ?? (suggest && !done ? (
              <button type="button" className="ghost-time" data-noswipe aria-label={`Auf ${suggest.time} legen`} onClick={(e) => { e.stopPropagation(); upd.mutate({ id: task.id, patch: { dueTime: suggest.time } }); }}>{suggest.time}</button>
            ) : "")}
          </span>
        )}
        {showTime && <span className="dot" style={{ background: done ? "var(--fg3)" : "var(--fg)" }} />}
        <span className="w">
          <b>{task.title}</b>
          {m.text && <span className={m.warn ? "warn" : ""}>{m.text}</span>}
        </span>
        <Check done={done} onToggle={() => toggle.mutate(task.id, !done)} label={done ? "Wieder öffnen" : "Erledigen"} />
      </div>
    </SwipeRow>
  );
}

const REPEAT_OPTIONS: [string, string][] = [["none", "Nie"], ["daily", "Täglich"], ["weekdays", "Werktags"], ["weekly", "Wöchentlich"], ["every", "Alle n Tage"], ["monthly", "Monatlich"], ["yearly", "Jährlich"]];

/** Wiederholung wählen: beim Erledigen entsteht die nächste Aufgabe. */
function RepeatField({ rule, dueDate, onChange }: { rule: string | null; dueDate: string | null; onChange: (r: string | null) => void }) {
  const r = parseRepeat(rule);
  const pick = (k: string) => {
    if (k === "other") return;
    onChange(k === "none" ? null : k === "weekly" ? buildRule({ kind: "weekly", days: [] }, dueDate) : k === "every" ? buildRule({ kind: "every", n: 2 }) : buildRule({ kind: k as "daily" | "weekdays" | "monthly" | "yearly" }));
  };
  return (
    <>
      <div className="field">
        <label htmlFor="ts-r">Wiederholen</label>
        <select id="ts-r" className="inp" value={r.kind} onChange={(e) => pick(e.target.value)}>
          {REPEAT_OPTIONS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
          {r.kind === "other" && <option value="other">Eigene Regel</option>}
        </select>
      </div>
      {r.kind === "weekly" && (
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <DayToggles label="Wochentage" value={r.days.length ? r.days : dueDate ? [weekdayNum(dueDate)] : []} onChange={(days) => onChange(buildRule({ kind: "weekly", days }, dueDate))} />
        </div>
      )}
      {r.kind === "every" && (
        <div className="field">
          <label htmlFor="ts-rn">Alle</label>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id="ts-rn" key={r.n} className="inp num" inputMode="numeric" defaultValue={r.n}
              onBlur={(e) => { const n = Math.round(num(e.target.value) ?? 0); if (n >= 1 && n <= 365 && n !== r.n) onChange(buildRule({ kind: "every", n })); else e.target.value = String(r.n); }} />
            <span className="faint">Tage</span>
          </span>
        </div>
      )}
    </>
  );
}

export function TaskSheet({ id }: { id: string }) {
  const sheet = useSheet();
  const today = useToday();
  const tasks = useTasks().data ?? [];
  const t = tasks.find((x) => x.id === id);
  const projects = useProjects().data ?? [];
  const upd = useUpdateTask();
  const del = useDeleteTask();
  const create = useCreateTask();
  const toggle = useToggleTask();
  const [sub, setSub] = useState("");
  useEffect(() => {
    if (!t && tasks.length) sheet.close();
  }, [t, tasks.length, sheet]);
  if (!t) return <div style={{ minHeight: 120 }} />;
  const set = (patch: Parameters<typeof upd.mutate>[0]["patch"]) => upd.mutate({ id, patch });
  const subs = tasks.filter((x) => x.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = !!t.doneAt;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: -8 }}>
        <Check done={done} onToggle={() => toggle.mutate(id, !done)} label={done ? "Wieder öffnen" : "Erledigen"} />
        <input className="inp grow" style={{ background: "none", fontSize: 22, fontWeight: 700, padding: 0, height: 52 }} defaultValue={t.title} aria-label="Titel" maxLength={500}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) set({ title: v }); else e.target.value = t.title; }} />
      </div>
      <div className="field">
        <label htmlFor="ts-d">Datum</label>
        <input id="ts-d" className="inp" type="date" defaultValue={t.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} />
      </div>
      <div className="field">
        <label htmlFor="ts-t">Uhrzeit</label>
        <input id="ts-t" className="inp" type="time" defaultValue={t.dueTime ?? ""} onChange={(e) => set({ dueTime: e.target.value || null })} />
      </div>
      <div className="field">
        <label htmlFor="ts-m">Dauer</label>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input id="ts-m" className="inp num" inputMode="numeric" defaultValue={t.durationMin ?? ""} placeholder="–"
            onBlur={(e) => { const n = num(e.target.value); const v = n && n >= 1 ? Math.round(n) : null; if (v !== t.durationMin) set({ durationMin: v }); }} />
          <span className="faint">min</span>
        </span>
      </div>
      <RepeatField rule={t.recurrence} dueDate={t.dueDate} onChange={(recurrence) => set({ recurrence })} />
      {projects.length > 0 && (
        <div className="field">
          <label htmlFor="ts-p">Projekt</label>
          <select id="ts-p" className="inp" value={t.projectId ?? ""} onChange={(e) => set({ projectId: e.target.value || null })}>
            <option value="">Keines</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <textarea className="inp" placeholder="Notiz" defaultValue={t.notes ?? ""} aria-label="Notiz" maxLength={10000}
          onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.notes) set({ notes: v }); }} />
      </div>
      <div className="sec">Unteraufgaben</div>
      {subs.map((s) => (
        <div key={s.id} className={`slot ${s.doneAt ? "done" : ""}`} style={{ gridTemplateColumns: "minmax(0,1fr) 44px", minHeight: 48 }}>
          <span className="w"><b>{s.title}</b></span>
          <Check done={!!s.doneAt} onToggle={() => toggle.mutate(s.id, !s.doneAt)} label="Unteraufgabe abhaken" />
        </div>
      ))}
      <form className="field" style={{ borderTop: subs.length ? "1px solid var(--line)" : 0 }} onSubmit={(e) => {
        e.preventDefault();
        const v = sub.trim();
        if (!v) return;
        create.mutate({ id: uid(), title: v, parentId: id });
        setSub("");
      }}>
        <input className="inp grow" style={{ textAlign: "left", maxWidth: "100%" }} placeholder="Unteraufgabe hinzufügen" value={sub} onChange={(e) => setSub(e.target.value)} maxLength={500} />
      </form>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" className="cta ghost press" style={{ marginTop: 0 }} onClick={() => set({ dueDate: addDays(todayInZone(), 1) })}>
          Auf morgen
        </button>
        <button type="button" className="cta press" style={{ marginTop: 0 }} onClick={() => { toggle.mutate(id, !done); if (!done) sheet.close(); }}>
          {done ? "Wieder öffnen" : "Erledigen"}
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        <ConfirmDelete onConfirm={() => { del.mutate(id); sheet.close(); }} />
      </div>
      <span hidden>{today}</span>
    </div>
  );
}

/* ---------- Tag ---------- */
export function TagSheet() {
  const sheet = useSheet();
  const d = useDay();
  const open = d.list.filter((t) => !t.doneAt);
  const done = d.list.filter((t) => t.doneAt);
  const tr = d.training;
  const trRow = tr && (
    <button type="button" className={`slot press ${tr.done ? "done" : ""}`} style={{ gridTemplateColumns: "minmax(0,1fr) 44px" }} onClick={() => sheet.open(<TrainingSheet day={d.today} />)}>
      <span className="w"><b>{tr.name}</b></span>
      <span className="chkhit"><span className="chk"><CheckMark /></span></span>
    </button>
  );
  return (
    <div>
      <h3>Heute</h3>
      <div className="when">{d.done} von {d.total} erledigt</div>
      {d.total === 0 && <div className="empty">Nichts geplant.</div>}
      {open.map((t) => (<TaskLine key={t.id} task={t} today={d.today} />))}
      {tr && !tr.done && trRow}
      {(done.length > 0 || tr?.done) && <div className="sec">Erledigt</div>}
      {done.map((t) => (<TaskLine key={t.id} task={t} today={d.today} />))}
      {tr?.done && trRow}
    </div>
  );
}

/* ---------- Training ---------- */
function SetRow({ s, day, index }: { s: GymSet; day: string; index: number }) {
  const upd = useUpdateSet(day);
  return (
    <div className={`exset ${s.done ? "done" : ""}`}>
      <button type="button" className={`chkhit press ${s.done ? "done" : ""}`} style={{ margin: 0 }} aria-pressed={s.done} aria-label={`Satz ${index + 1} abhaken`} onClick={() => upd.mutate({ id: s.id, patch: { done: !s.done } })}>
        <span className="chk"><CheckMark /></span>
      </button>
      <span className="rp">{s.reps} ×</span>
      <span className="kg">
        <input key={`${s.id}-${s.weight}`} className="inp num" inputMode="decimal" defaultValue={s.weight ?? ""} placeholder="–" aria-label={`Gewicht Satz ${index + 1}`}
          onBlur={(e) => { const v = e.target.value.trim() === "" ? null : num(e.target.value); if (v !== s.weight && (v === null || v >= 0)) upd.mutate({ id: s.id, patch: { weight: v } }); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        kg
      </span>
    </div>
  );
}

export function TrainingSheet({ day }: { day: string }) {
  const sheet = useSheet();
  const today = useToday();
  const q = useGymDay(day);
  const start = useStartSession(day);
  const fin = useFinishSession(day);
  const rem = useRemoveSession(day);
  const hist = useGymHistory().data ?? {};
  const asked = useRef(false);
  const data = q.data;
  const isToday = day === today;
  useEffect(() => {
    if (data && !data.session && data.plan && isToday && !asked.current) {
      asked.current = true;
      start.mutate();
    }
  }, [data, isToday, start]);
  if (!data) return <div style={{ minHeight: 160 }} />;
  const s = data.session;
  const plan = data.plan;
  const groups: { name: string; sets: GymSet[] }[] = [];
  for (const x of s?.sets ?? []) {
    const g = groups.find((y) => y.name === x.exerciseName);
    g ? g.sets.push(x) : groups.push({ name: x.exerciseName, sets: [x] });
  }
  const finished = !!s?.finishedAt;
  const title = isToday ? "Training heute" : "Training";
  const when = [isToday ? null : dayCompact(day), s?.planName ?? plan?.name].filter(Boolean).join(" · ");
  const toPlans = () => { sheet.close(); navigate("/plaene"); };
  return (
    <div>
      <h3>{title}</h3>
      {when && <div className="when">{when}</div>}
      <FitbitHinweis day={day} />
      {!s && !plan && (
        <div className="empty">
          <span>Kein Plan für diesen Tag.</span>
          <button type="button" className="chip btn press" onClick={() => fin.mutate(true)}>Als Training eintragen</button>
          <button type="button" className="link" onClick={toPlans}>Pläne</button>
        </div>
      )}
      {!s && plan && !isToday && (
        <div className="empty">
          <span>Kein Training eingetragen.</span>
          <button type="button" className="chip btn press" onClick={() => start.mutate()}>Nachtragen</button>
        </div>
      )}
      {s && groups.length === 0 && (
        <div className="empty">
          <span>{plan && plan.exercises.length === 0 ? "Dieser Plan hat noch keine Übungen." : "Training ohne Übungen."}</span>
          {plan && plan.exercises.length === 0 && <button type="button" className="chip btn press" onClick={toPlans}>Übungen hinzufügen</button>}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.name}>
          <div className="exh">
            <b>{g.name}</b>
            <Spark values={(hist[g.name] ?? []).map((p) => p.weight)} />
          </div>
          {g.sets.map((x, i) => (<SetRow key={x.id} s={x} day={day} index={i} />))}
        </div>
      ))}
      {s && (
        <button type="button" className={`cta press ${finished ? "ghost" : ""}`} onClick={() => fin.mutate(!finished)}>
          {finished ? "Abgeschlossen" : "Training abschliessen"}
        </button>
      )}
      {s && !isToday && <div style={{ marginTop: 10 }}><ConfirmDelete label="Eintrag entfernen" onConfirm={() => { rem.mutate(); sheet.close(); }} /></div>}
    </div>
  );
}

/* ---------- Plan bearbeiten ---------- */
interface Draft { id: string; name: string; sets: string; reps: string; weight: string }
export function PlanSheet({ id }: { id: string | null }) {
  const sheet = useSheet();
  const plans = useGymPlans().data ?? [];
  const existing = id ? plans.find((p) => p.id === id) : undefined;
  const save = useSavePlan();
  const del = useDeletePlan();
  const [name, setName] = useState(existing?.name ?? "");
  const [days, setDays] = useState<number[]>(existing?.weekdays ?? []);
  const [ex, setEx] = useState<Draft[]>(() => (existing?.exercises ?? []).map((e) => ({ id: e.id, name: e.name, sets: String(e.sets), reps: String(e.reps), weight: e.weight === null ? "" : String(e.weight) })));
  const valid = name.trim().length > 0;
  const upd = (i: number, k: keyof Draft, v: string) => setEx((l) => l.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const submit = () => {
    if (!valid) return;
    const plan = {
      name: name.trim(),
      weekdays: days,
      exercises: ex.filter((e) => e.name.trim()).map((e) => ({
        id: e.id.startsWith("neu-") ? undefined : e.id,
        name: e.name.trim(),
        sets: Math.max(1, Math.min(12, Math.round(num(e.sets) ?? 3))),
        reps: Math.max(1, Math.min(100, Math.round(num(e.reps) ?? 10))),
        weight: e.weight.trim() === "" ? null : num(e.weight),
      })),
    };
    save.mutate({ id: existing?.id, plan: existing ? plan : { ...plan, id: uid() } });
    sheet.close();
  };
  return (
    <div>
      <h3>{existing ? "Plan" : "Neuer Plan"}</h3>
      <div className="field" style={{ borderTop: 0 }}>
        <input className="inp grow" style={{ textAlign: "left", maxWidth: "100%" }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Name" />
      </div>
      <div className="sec">Wochentage</div>
      <DayToggles value={days} onChange={setDays} label="Wochentage" />
      <div className="sec">Übungen</div>
      {ex.length === 0 && (
        <div className="empty" style={{ paddingTop: 4 }}>
          <button type="button" className="chip btn press" onClick={() => setEx([{ id: "neu-" + uid(), name: "", sets: "3", reps: "10", weight: "" }])}>Übungen hinzufügen</button>
        </div>
      )}
      {ex.map((e, i) => (
        <div key={e.id} style={{ borderTop: i ? "1px solid var(--line)" : 0, padding: "10px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="inp grow" placeholder="Übung" value={e.name} onChange={(ev) => upd(i, "name", ev.target.value)} maxLength={120} aria-label="Übung" />
            <button type="button" className="iconbtn press" aria-label="Übung entfernen" onClick={() => setEx((l) => l.filter((_, j) => j !== i))}><Icon n="trash" /></button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, color: "var(--fg3)", fontSize: 13 }}>
            <input className="inp num" inputMode="numeric" value={e.sets} onChange={(ev) => upd(i, "sets", ev.target.value)} aria-label="Sätze" /> Sätze
            <input className="inp num" inputMode="numeric" value={e.reps} onChange={(ev) => upd(i, "reps", ev.target.value)} aria-label="Wiederholungen" /> Wdh.
            <input className="inp num" inputMode="decimal" value={e.weight} placeholder="–" onChange={(ev) => upd(i, "weight", ev.target.value)} aria-label="Gewicht" /> kg
          </div>
        </div>
      ))}
      {ex.length > 0 && (
        <button type="button" className="link" onClick={() => setEx((l) => [...l, { id: "neu-" + uid(), name: "", sets: "3", reps: "10", weight: "" }])}>
          <Icon n="plus" className="" /> Übung
        </button>
      )}
      <button type="button" className="cta press" disabled={!valid} onClick={submit}>Speichern</button>
      {existing && <div style={{ marginTop: 10 }}><ConfirmDelete label="Plan löschen" onConfirm={() => { del.mutate(existing.id); sheet.close(); }} /></div>}
    </div>
  );
}

/* ---------- Prüfung ---------- */
const ICONS = [
  <svg key="0" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" /></svg>,
  <svg key="1" viewBox="0 0 18 18"><path d="M3 11c2-5 4 3 6-2s4 3 6-2" /></svg>,
  <svg key="2" viewBox="0 0 18 18"><path d="M3.5 9.5 7.2 13 14.5 5" /></svg>,
];
const LAB = ["offen", "unsicher", "sitzt"];

export function ExamSheet({ id }: { id: string }) {
  const q = useExam(id);
  const set = useSetAssessment(id);
  const add = useAddTopic(id);
  const plan = usePlanStudy(id);
  const tasks = useTasks().data ?? [];
  const [topic, setTopic] = useState("");
  const e = q.data;
  if (!e) return <div style={{ minHeight: 200 }} />;
  const planned = tasks.filter((t) => t.examId === id && !t.doneAt).length;
  const n = e.topics.filter((t) => t.assessment === 2).length;
  const u = e.topics.filter((t) => t.assessment === 1).length;
  const when = [dayCompact(e.date), e.startTime, e.room].filter(Boolean).join(", ");
  const days = daysUntil(e.date);
  return (
    <div>
      <h3>{e.subjectCode}: {e.title}</h3>
      <p className="when">
        {when} · {inDays(days)}
        {e.hint && <><br /><span className="warn">{e.hint}</span></>}
      </p>
      <div className="ready">{e.topics.map((t) => (<i key={t.id} className={`s${t.assessment}`} />))}</div>
      <p className="legend">{n} sitzt, {u} unsicher, {e.topics.length - n - u} offen</p>
      {e.topics.map((t) => (
        <div key={t.id} className="tp">
          <b>{t.title}</b>
          <span className="seg tri">
            {[0, 1, 2].map((k) => (
              <button key={k} type="button" className="press" data-k={k} aria-label={LAB[k]} aria-pressed={t.assessment === k} onClick={() => set.mutate({ topicId: t.id, assessment: k as 0 | 1 | 2 })}>
                <svg viewBox="0 0 18 18">{ICONS[k].props.children}</svg>
              </button>
            ))}
          </span>
        </div>
      ))}
      <form className="field" style={{ borderTop: "1px solid var(--line)" }} onSubmit={(ev) => {
        ev.preventDefault();
        const v = topic.trim();
        if (!v) return;
        add.mutate({ id: uid(), title: v });
        setTopic("");
      }}>
        <input className="inp grow" style={{ textAlign: "left", maxWidth: "100%" }} placeholder="Thema hinzufügen" value={topic} onChange={(ev) => setTopic(ev.target.value)} maxLength={300} />
      </form>
      <button type="button" className={`cta press ${plan.isPending ? "ghost" : ""}`} disabled={n === e.topics.length || days < 1} onClick={() => plan.mutate(planned > 0)}>
        {plan.isPending ? "Eingeplant" : planned > 0 ? `Neu einplanen · ${planned} Blöcke` : "Lernblöcke einplanen"}
      </button>
    </div>
  );
}

/* ---------- Fach ---------- */
export function SubjectSheet({ id }: { id: string }) {
  const subjects = useSubjects().data ?? [];
  const grades = useGrades().data ?? [];
  const add = useAddGrade();
  const del = useDeleteGrade();
  const today = useToday();
  const row = useMemo(() => subjectAverages(subjects, grades).find((r) => r.subject.id === id), [subjects, grades, id]);
  const [value, setValue] = useState("");
  const [weight, setWeight] = useState("1");
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("4.5");
  const [rw, setRw] = useState("1");
  if (!row) return <div style={{ minHeight: 160 }} />;
  const v = num(value);
  const w = num(weight);
  const valid = v !== null && v >= 1 && v <= 6 && w !== null && w > 0 && !!date;
  const tg = num(target);
  const need = tg !== null && num(rw) ? neededGrade(row.grades, tg, num(rw)!) : null;
  const avg = row.avg;
  return (
    <div>
      <h3>{row.subject.code}</h3>
      <div className="yh" style={{ paddingTop: 4 }}>
        <b className={avg !== null && avg < 4 ? "bad" : ""}>{avg === null ? "–" : nf(avg, 2)}</b>
        <span>Schnitt</span>
      </div>
      {row.grades.length === 0 && <div className="empty" style={{ paddingTop: 0 }}>Noch keine Note.</div>}
      {row.grades.map((g) => (
        <div key={g.id} className="row">
          <div className="l"><b>{nf(g.value, 1)}{g.weight !== 1 ? <span className="faint"> × {nf(g.weight, 1)}</span> : null}</b><span>{dayCompact(g.date)}{g.title ? ` · ${g.title}` : ""}</span></div>
          <button type="button" className="iconbtn press" aria-label="Note löschen" onClick={() => del.mutate(g.id)}><Icon n="trash" /></button>
        </div>
      ))}
      <div className="sec">Note hinzufügen</div>
      <div className="field"><label htmlFor="g-v">Note</label><input id="g-v" className="inp num" inputMode="decimal" placeholder="4.5" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-w">Gewicht</label><input id="g-w" className="inp num" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-d">Datum</label><input id="g-d" className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-t">Bezeichnung</label><input id="g-t" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></div>
      <button type="button" className="cta press" disabled={!valid} onClick={() => {
        add.mutate({ id: uid(), subjectId: id, value: Math.round(v! * 100) / 100, weight: w!, date, title: title.trim() || null });
        setValue(""); setTitle("");
      }}>Hinzufügen</button>
      <div className="sec">Welche Note brauche ich?</div>
      <div className="field"><label htmlFor="r-t">Schnitt</label><input id="r-t" className="inp num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
      <div className="field"><label htmlFor="r-w">Gewicht der Prüfung</label><input id="r-w" className="inp num" inputMode="decimal" value={rw} onChange={(e) => setRw(e.target.value)} /></div>
      <div className="yh" style={{ paddingBottom: 0 }}>
        {need?.kind === "need" && <><b>{nf(need.value, 1)}</b><span>nötig</span></>}
        {need?.kind === "reached" && <b style={{ fontSize: 22 }} className="good">Schon erreicht</b>}
        {need?.kind === "impossible" && <b style={{ fontSize: 22 }} className="bad">Nicht mehr erreichbar</b>}
        {!need && <b className="faint">–</b>}
      </div>
    </div>
  );
}

/* ---------- kleine Helfer für andere Seiten ---------- */
export { WEEKDAY_LETTERS, WEEK_ORDER, weekdayNum };
export type { GymPlan };
export const _r: ReactNode = null;
export const SegmentsRe = Segments;
