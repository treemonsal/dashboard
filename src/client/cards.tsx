// Karten, die auf mehreren Seiten vorkommen (Entwurf: data-v="heute ziele ...").
import { Link } from "./router";
import { dayCompact, daysUntil, mondayOf, addDays, weekdayNum } from "../shared/dates";
import { useSheet } from "./sheet";
import { ExamSheet, SubjectSheet, TrainingSheet } from "./sheets";
import { Icon, nf } from "./ui";
import { gesamt, subjectAverages } from "./lib";
import { useExams, useGrades, useGymDays, useGymPlans, useSettings, useSubjects, useToday } from "./queries";

export function YearCard() {
  const today = useToday();
  const exams = useExams().data ?? [];
  const y = Number(today.slice(0, 4));
  const total = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const doy = Math.round((Date.UTC(y, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const examDays = new Set(exams.map((e) => (e.date.startsWith(String(y)) ? Math.round((Date.UTC(y, Number(e.date.slice(5, 7)) - 1, Number(e.date.slice(8, 10))) - Date.UTC(y, 0, 1)) / 86400000) : -1)));
  return (
    <Link href="/zeit" className="card tap press" aria-label="Zeit öffnen">
      <div className="yh">
        <b>{total - doy}</b>
        <span>Tage bis {y + 1}</span>
      </div>
      <div className="dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < doy - 1 ? "p" : i === doy - 1 ? "now" : examDays.has(i) ? "x" : ""} />
        ))}
      </div>
    </Link>
  );
}

export function GymCard() {
  const today = useToday();
  const sheet = useSheet();
  const goal = Number(useSettings().gymGoal);
  const { from, done } = useGymDays(16);
  const planned = new Set(useGymPlans().data?.flatMap((p) => p.weekdays) ?? []);
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, r) => addDays(monday, r));
  // Verpasst zählt erst ab dem ersten eingetragenen Training, nicht für die Zeit vor der App.
  const since = [...done].sort()[0] ?? today;
  const n = week.filter((d) => done.has(d)).length;
  const cells: { d: string; r: number }[] = [];
  for (let w = 0; w < 16; w++) for (let r = 0; r < 7; r++) cells.push({ d: addDays(from, w * 7 + r), r });
  return (
    <div className="card">
      <h2>
        <span>Gym</span>
        <span>
          <span className="wk" aria-hidden="true">
            {week.map((d, r) => (
              <i key={d} className={`${done.has(d) ? "g" : ""} ${r === 6 ? "s" : ""} ${d === today ? "t" : ""} ${d < today && d >= since && planned.has(weekdayNum(d)) ? "m" : ""}`} />
            ))}
          </span>
          {n} von {goal}
        </span>
      </h2>
      <div className="gym" role="group" aria-label="Gym-Raster der letzten 16 Wochen">
        {cells.map(({ d, r }) =>
          d > today ? (
            <i key={d} className="f" />
          ) : (
            <button key={d} type="button" className={`press ${done.has(d) ? "g" : ""} ${d === today ? "t" : ""} ${r === 6 ? "s" : ""} ${d < today && d >= since && planned.has(weekdayNum(d)) ? "m" : ""}`} aria-label={`${dayCompact(d)}${done.has(d) ? ", Training" : planned.has(weekdayNum(d)) && d < today && d >= since ? ", verpasst" : ""}`} onClick={() => sheet.open(<TrainingSheet day={d} />)} />
          ),
        )}
      </div>
      <Link href="/plaene" className="more press">
        Pläne
      </Link>
    </div>
  );
}

export function ExamsCard({ limit = 4 }: { limit?: number }) {
  const exams = useExams().data ?? [];
  const sheet = useSheet();
  if (!exams.length) return null;
  return (
    <div className="card">
      <h2>Prüfungen</h2>
      <div>
        {exams.slice(0, limit).map((e) => {
          const n = daysUntil(e.date);
          return (
            <button key={e.id} type="button" className="ex press" onClick={() => sheet.open(<ExamSheet id={e.id} />)}>
              <span className="f">{e.subjectCode}</span>
              <span className="w">
                <b>{e.title}</b>
                <span>{dayCompact(e.date)}</span>
              </span>
              <span className={`n${n < 15 ? " soon" : ""}`}>{n} T</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NotenCard() {
  const subjects = useSubjects().data ?? [];
  const grades = useGrades().data ?? [];
  const sheet = useSheet();
  const rows = subjectAverages(subjects, grades);
  const avg = gesamt(rows);
  const counted = rows.filter((r) => r.counts);
  // Nicht zählende Fächer nur zur Information: getrennt am Ende, gedämpft, ohne Rot, ohne Zielstrich. Ohne Note gar nicht.
  const info = rows.filter((r) => !r.counts && r.avg !== null);
  return (
    <div className="card">
      <h2>
        Noten
      </h2>
      <div className="yh">
        <b>{avg === null ? "–" : nf(avg, 1)}</b>
        <span>Schnitt</span>
      </div>
      <div style={{ paddingBottom: 8 }}>
        {counted.map((r) => (
          <button key={r.subject.id} type="button" className={`gr press${r.avg !== null && r.avg < 4 ? " bad" : ""}`} onClick={() => sheet.open(<SubjectSheet id={r.subject.id} />)}>
            <span>{r.subject.code}</span>
            <span className="tk">{r.avg !== null && <i style={{ width: `${((r.avg - 1) / 5) * 100}%` }} />}</span>
            <span className={r.avg === null ? "none" : ""}>{r.avg === null ? "–" : nf(r.avg, 1)}</span>
          </button>
        ))}
        {info.length > 0 && <div className="grinfo" role="group" aria-label="Zählt nicht zum Schnitt">
          {info.map((r) => (
            <button key={r.subject.id} type="button" className="gr info press" onClick={() => sheet.open(<SubjectSheet id={r.subject.id} />)}>
              <span>{r.subject.code}</span>
              <span className="tk"><i style={{ width: `${((r.avg! - 1) / 5) * 100}%` }} /></span>
              <span>{nf(r.avg!, 1)}</span>
            </button>
          ))}
        </div>}
      </div>
    </div>
  );
}

export { weekdayNum, Icon };
