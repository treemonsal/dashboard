// Schule in die Tiefe unter /ziele/...
//   noten, noten/<fach>, noten/<fach>/<note>        Notenschnitt, Fach, Note
//   pruefung/<id>, pruefung/<id>/<thema>            Prüfung, Themenseite (Einschätzung, Lernaufgaben, Notiz, Zusammenfassung)
import { useEffect, useState } from "react";
import { QueryNotice, SaveNotice } from "./query-state";
import { Link, navigate } from "./router";
import { dayCompact, daysUntil, inDays } from "../shared/dates";
import { MIN_SUBJECT, TARGET_AVERAGE, neededGrade, subjectMarks } from "../shared/calc";
import { gradeImpact, taskTopic } from "../shared/tiefe";
import { ConfirmDelete, Icon, Segments, nf } from "./ui";
import { NotFound, Stage } from "./tiefe";
import { gesamt, subjectAverages } from "./lib";
import { useSheet } from "./sheet";
import { ZieleGym } from "./gym-tiefe";
import {
  useAddGrade, useAddTopic, useDeleteGrade, useExam, useGrades, usePlanStudy, useSetAssessment, useSetSubjectCounts, useSetTopicNotes, useSubjects, useTasks, useToday,
} from "./queries";

const uid = () => crypto.randomUUID();
const num = (s: string) => { const n = parseFloat(s.replace(",", ".")); return Number.isFinite(n) ? n : null; };
const LAB = ["offen", "unsicher", "sitzt"];
const ICONS = [
  <svg key="0" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.5" /></svg>,
  <svg key="1" viewBox="0 0 18 18"><path d="M3 11c2-5 4 3 6-2s4 3 6-2" /></svg>,
  <svg key="2" viewBox="0 0 18 18"><path d="M3.5 9.5 7.2 13 14.5 5" /></svg>,
];

export function ZieleTiefe({ path }: { path: string }) {
  const segs = path.split("/").filter(Boolean).slice(1);
  if (segs[0] === "noten") return <Noten segs={segs} />;
  if (segs[0] === "pruefung" && segs[1]) return <Pruefung id={segs[1]} topicId={segs[2]} />;
  if (segs[0] === "gym") return <ZieleGym segs={segs} />;
  return <Stage title="Ziele" back="/ziele"><NotFound /></Stage>;
}

/* ---------- Noten ---------- */
function Noten({ segs }: { segs: string[] }) {
  const subjectsQ = useSubjects();
  const gradesQ = useGrades();
  const subjects = subjectsQ.data ?? [];
  const grades = gradesQ.data ?? [];
  if (!subjectsQ.isSuccess || !gradesQ.isSuccess) return <Stage title="Noten" back="/ziele"><QueryNotice pending={subjectsQ.isPending || gradesQ.isPending} error={subjectsQ.error ?? gradesQ.error} /></Stage>;
  const rows = subjectAverages(subjects, grades);
  if (segs[1]) {
    const code = decodeURIComponent(segs[1]);
    const row = rows.find((r) => r.subject.code === code);
    if (!row) return <Stage title="Fach" back="/ziele/noten"><NotFound /></Stage>;
    if (segs[2]) return <Note row={row} gradeId={segs[2]} />;
    return <Fach row={row} />;
  }
  const avg = gesamt(rows);
  const counted = rows.filter((r) => r.counts);
  const info = rows.filter((r) => !r.counts && r.avg !== null);
  const Row = ({ r, dim = false }: { r: (typeof rows)[number]; dim?: boolean }) => (
    <Link href={`/ziele/noten/${encodeURIComponent(r.subject.code)}`} className={`gr press${!dim && r.avg !== null && r.avg < MIN_SUBJECT ? " bad" : ""}${dim ? " info" : ""}`}>
      <span>{r.subject.code}</span>
      <span className="tk">{r.avg !== null && <i style={{ width: `${((r.avg - 1) / 5) * 100}%` }} />}</span>
      <span className={r.avg === null ? "none" : ""}>{r.avg === null ? "–" : nf(r.avg, 1)}</span>
    </Link>
  );
  return (
    <Stage title="Noten" back="/ziele" crumbs={[{ label: "Noten" }]}>
      <div className="center">
        <span className="bigv">{avg === null ? "–" : nf(avg, 2)}</span>
        <span className="lbl">Schnitt · Ziel {nf(TARGET_AVERAGE, 1)}, kein Fach unter {MIN_SUBJECT}</span>
      </div>
      <div className="card">
        <h2>Fächer</h2>
        <div style={{ paddingBottom: 8 }}>
          {counted.map((r) => <Row key={r.subject.id} r={r} />)}
          {info.length > 0 && <div className="grinfo" role="group" aria-label="Zählt nicht zum Schnitt">{info.map((r) => <Row key={r.subject.id} r={r} dim />)}</div>}
        </div>
      </div>
    </Stage>
  );
}

function Fach({ row }: { row: ReturnType<typeof subjectAverages>[number] }) {
  const sheet = useSheet();
  const setCounts = useSetSubjectCounts();
  const [target, setTarget] = useState("4.5");
  const [rw, setRw] = useState("1");
  const code = row.subject.code;
  const avg = row.avg;
  const marks = subjectMarks(avg);
  const tg = num(target);
  const need = tg !== null && num(rw) ? neededGrade(row.grades, tg, num(rw)!) : null;
  const list = [...row.grades].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return (
    <Stage title={code} back="/ziele/noten" crumbs={[{ label: "Noten", href: "/ziele/noten" }, { label: row.subject.name ? `${row.subject.name} (${code})` : code }]}>
      <div className="center">
        <span className={`bigv ${row.counts ? (avg !== null && avg < MIN_SUBJECT ? "bad" : "") : "faint"}`}>{avg === null ? "–" : nf(avg, 2)}</span>
        <span className="lbl">{marks && row.counts ? `Zeugnis ${nf(marks.certificate, 1)}` : "Schnitt"}</span>
      </div>
      <div className="card">
        <h2>Noten</h2>
        {list.length === 0 && <div className="empty">Noch keine Note.</div>}
        {list.map((g) => (
          <Link key={g.id} href={`/ziele/noten/${encodeURIComponent(code)}/${g.id}`} className="lrow nopic press">
            <span className="w"><b>{nf(g.value, 1)}{g.weight !== 1 ? <span className="faint"> × {nf(g.weight, 1)}</span> : null}</b><span>{dayCompact(g.date)}{g.title ? ` · ${g.title}` : ""}</span></span>
            <span className="a"><Icon n="chev" className="go" /></span>
          </Link>
        ))}
        <button type="button" className="more press" onClick={() => sheet.open(<GradeAdd subjectId={row.subject.id} />)}>Note hinzufügen</button>
      </div>
      <div className="card" style={{ paddingTop: 0 }}>
        <div className="field" style={{ borderTop: 0 }}>
          <span>Zählt zum Schnitt</span>
          <Segments full={false} label="Zählt zum Schnitt" value={row.counts ? "1" : "0"} onChange={(v) => setCounts.mutate({ id: row.subject.id, counts: v === "1" })} options={[{ v: "0", label: "Aus" }, { v: "1", label: "An" }]} />
        </div>
      </div>
      {row.counts && (
        <div className="card" style={{ paddingTop: 0 }}>
          <h2>Welche Note brauche ich?</h2>
          <div className="field" style={{ borderTop: 0 }}><label htmlFor="r-t">Schnitt</label><input id="r-t" className="inp num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          <div className="field"><label htmlFor="r-w">Gewicht der Prüfung</label><input id="r-w" className="inp num" inputMode="decimal" value={rw} onChange={(e) => setRw(e.target.value)} /></div>
          <div className="yh" style={{ paddingBottom: 8 }}>
            {need?.kind === "need" && <><b>{nf(need.value, 1)}</b><span>nötig</span></>}
            {need?.kind === "reached" && <b style={{ fontSize: 22 }} className="good">Schon erreicht</b>}
            {need?.kind === "impossible" && <b style={{ fontSize: 22 }} className="bad">Nicht mehr erreichbar</b>}
            {!need && <b className="faint">–</b>}
          </div>
        </div>
      )}
    </Stage>
  );
}

function GradeAdd({ subjectId }: { subjectId: string }) {
  const sheet = useSheet();
  const add = useAddGrade();
  const today = useToday();
  const [value, setValue] = useState("");
  const [weight, setWeight] = useState("1");
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const v = num(value), w = num(weight);
  const valid = v !== null && v >= 1 && v <= 6 && w !== null && w > 0 && !!date;
  return (
    <div>
      <h3>Note hinzufügen</h3>
      <SaveNotice error={add.error} />
      <div className="field"><label htmlFor="g-v">Note</label><input id="g-v" className="inp num" inputMode="decimal" placeholder="4.5" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-w">Gewicht</label><input id="g-w" className="inp num" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-d">Datum</label><input id="g-d" className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="field"><label htmlFor="g-t">Bezeichnung</label><input id="g-t" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></div>
      <button type="button" className="cta press" disabled={!valid || add.isPending} onClick={() => add.mutate({ id: uid(), subjectId, value: Math.round(v! * 100) / 100, weight: w!, date, title: title.trim() || null }, { onSuccess: sheet.close })}>Hinzufügen</button>
    </div>
  );
}

function Note({ row, gradeId }: { row: ReturnType<typeof subjectAverages>[number]; gradeId: string }) {
  const del = useDeleteGrade();
  const g = row.grades.find((x) => x.id === gradeId);
  const code = row.subject.code;
  const back = `/ziele/noten/${encodeURIComponent(code)}`;
  if (!g) return <Stage title="Note" back={back}><NotFound /></Stage>;
  const imp = gradeImpact(row.grades, g.id);
  const t45 = neededGrade(row.grades, TARGET_AVERAGE, 1);
  const t4 = neededGrade(row.grades, MIN_SUBJECT, 1);
  const need = (n: typeof t45) => (n?.kind === "need" ? nf(n.value, 1) : n?.kind === "reached" ? "schon erreicht" : n?.kind === "impossible" ? "nicht erreichbar" : "–");
  return (
    <Stage title={`${code} ${nf(g.value, 1)}`} back={back} crumbs={[{ label: "Noten", href: "/ziele/noten" }, { label: code, href: back }, { label: dayCompact(g.date) }]}>
      <div className="center"><span className={`bigv ${g.value < MIN_SUBJECT ? "bad" : ""}`}>{nf(g.value, 2)}</span><span className="lbl">{g.title ?? "Note"}</span></div>
      <div className="card" style={{ paddingTop: 0 }}>
        <div className="kv"><span>Gewicht</span><span>{nf(g.weight, 1)}</span></div>
        <div className="kv"><span>Datum</span><span>{dayCompact(g.date)}</span></div>
        {g.source && <div className="kv"><span>Quelle</span><span>{g.source}</span></div>}
      </div>
      {imp && (
        <div className="card" style={{ paddingTop: 0 }}>
          <h2>Fachschnitt</h2>
          <div className="kv" style={{ borderTop: 0 }}><span>Davor</span><span>{imp.before === null ? "–" : nf(imp.before, 2)}</span></div>
          <div className="kv"><span>Danach</span><span>{nf(imp.after, 2)}</span></div>
          {imp.delta !== null && <div className="kv"><span>Verschoben um</span><span className={imp.delta < 0 ? "warn" : imp.delta > 0 ? "good" : ""}>{imp.delta > 0 ? "+" : imp.delta < 0 ? "−" : ""}{nf(Math.abs(imp.delta), 2)}</span></div>}
        </div>
      )}
      {row.counts && (
        <div className="card" style={{ paddingTop: 0 }}>
          <h2>Die nächste Note</h2>
          <div className="kv" style={{ borderTop: 0 }}><span>Für Schnitt {nf(TARGET_AVERAGE, 1)}</span><span>{need(t45)}</span></div>
          <div className="kv"><span>Für mindestens {nf(MIN_SUBJECT, 1)}</span><span>{need(t4)}</span></div>
        </div>
      )}
      <ConfirmDelete label="Note löschen" onConfirm={() => { if (!del.isPending) del.mutate(g.id, { onSuccess: () => navigate(back) }); }} />
    </Stage>
  );
}

/* ---------- Prüfung und Themen ---------- */
function Pruefung({ id, topicId }: { id: string; topicId?: string }) {
  const q = useExam(id);
  const e = q.data;
  const back = `/ziele/pruefung/${id}`;
  if (!e) return <Stage title="Prüfung" back="/ziele"><QueryNotice pending={q.isPending} error={q.error} /></Stage>;
  if (topicId) return <Thema exam={e} topicId={topicId} />;
  return <PruefungSeite exam={e} back={back} />;
}

function PruefungSeite({ exam: e }: { exam: NonNullable<ReturnType<typeof useExam>["data"]>; back: string }) {
  const add = useAddTopic(e.id);
  const plan = usePlanStudy(e.id);
  const set = useSetAssessment(e.id);
  const taskQuery = useTasks();
  const [topic, setTopic] = useState("");
  const tasks = taskQuery.data ?? [];
  const planned = tasks.filter((t) => t.examId === e.id && !t.doneAt).length;
  const n = e.topics.filter((t) => t.assessment === 2).length;
  const u = e.topics.filter((t) => t.assessment === 1).length;
  const days = daysUntil(e.date);
  const when = [dayCompact(e.date), e.startTime, e.room].filter(Boolean).join(", ");
  return (
    <Stage title={`${e.subjectCode}: ${e.title}`} back="/ziele" crumbs={[{ label: e.subjectCode, href: `/ziele/noten/${encodeURIComponent(e.subjectCode)}` }, { label: e.title }]}>
      <SaveNotice error={add.error ?? plan.error ?? set.error} />
      <div className="center"><span className="bigv">{days}<small>Tage</small></span><span className="lbl">{when} · {inDays(days)}</span>{e.hint && <span className="warn">{e.hint}</span>}</div>
      <div className="card">
        <h2>Themen <span>{n} sitzt, {u} unsicher, {e.topics.length - n - u} offen</span></h2>
        <div className="ready" style={{ marginBottom: 4 }}>{e.topics.map((t) => <i key={t.id} className={`s${t.assessment}`} />)}</div>
        {e.topics.length === 0 && <div className="empty">Noch kein Thema.</div>}
        {e.topics.map((t) => (
          <Link key={t.id} href={`/ziele/pruefung/${e.id}/${t.id}`} className="lrow nopic press">
            <span className="w"><b>{t.title}</b><span>{LAB[t.assessment]}{t.notes ? " · Notiz" : ""}{t.summary ? " · Zusammenfassung" : ""}</span></span>
            <span className="a"><span className="seg tri" aria-hidden="true"><span className="press" data-k={t.assessment} aria-pressed="true" style={{ display: "grid", placeItems: "center", width: 36, height: 36 }}><svg viewBox="0 0 18 18" width="18" height="18">{ICONS[t.assessment]!.props.children}</svg></span></span><Icon n="chev" className="go" /></span>
          </Link>
        ))}
        <form className="field" style={{ borderTop: "1px solid var(--line)" }} onSubmit={(ev) => {
          ev.preventDefault();
          const v = topic.trim();
          if (!v || add.isPending) return;
          add.mutate({ id: uid(), title: v }, { onSuccess: () => setTopic((c) => (c === topic ? "" : c)) });
        }}>
          <input className="inp grow" style={{ textAlign: "left", maxWidth: "100%" }} placeholder="Thema hinzufügen" value={topic} onChange={(ev) => setTopic(ev.target.value)} maxLength={300} />
        </form>
      </div>
      <button type="button" className={`cta press ${plan.isPending ? "ghost" : ""}`} style={{ marginTop: 0 }} disabled={n === e.topics.length || days < 1 || plan.isPending || taskQuery.isPending || !!taskQuery.error} onClick={() => plan.mutate(planned > 0)}>
        {plan.isPending ? "Wird eingeplant" : planned > 0 ? `Neu einplanen · ${planned} Blöcke` : "Lernblöcke einplanen"}
      </button>
    </Stage>
  );
}

function Thema({ exam: e, topicId }: { exam: NonNullable<ReturnType<typeof useExam>["data"]>; topicId: string }) {
  const set = useSetAssessment(e.id);
  const saveNotes = useSetTopicNotes(e.id);
  const tasks = useTasks().data ?? [];
  const t = e.topics.find((x) => x.id === topicId);
  const [notes, setNotes] = useState(t?.notes ?? "");
  useEffect(() => setNotes(t?.notes ?? ""), [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = `/ziele/pruefung/${e.id}`;
  if (!t) return <Stage title="Thema" back={back}><NotFound /></Stage>;
  const linked = tasks.filter((x) => x.examId === e.id && taskTopic(x, e.topics)?.id === t.id).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return (
    <Stage title={t.title} back={back} crumbs={[{ label: e.subjectCode, href: `/ziele/noten/${encodeURIComponent(e.subjectCode)}` }, { label: e.title, href: back }, { label: t.title }]}>
      <SaveNotice error={set.error ?? saveNotes.error} />
      <div className="card" style={{ paddingTop: 0 }}>
        <h2>Einschätzung</h2>
        <div className="tp" style={{ borderTop: 0 }}>
          <b>{LAB[t.assessment]}</b>
          <span className="seg tri">
            {[0, 1, 2].map((k) => (
              <button key={k} type="button" className="press" data-k={k} aria-label={LAB[k]} aria-pressed={t.assessment === k} onClick={() => set.mutate({ topicId: t.id, assessment: k as 0 | 1 | 2 })}>
                <svg viewBox="0 0 18 18">{ICONS[k]!.props.children}</svg>
              </button>
            ))}
          </span>
        </div>
      </div>
      <div className="card">
        <h2>Lernaufgaben</h2>
        {linked.length === 0 && <div className="empty">Keine Lernaufgabe zu diesem Thema.</div>}
        {linked.map((x) => (
          <Link key={x.id} href="/aufgaben" className="lrow nopic press">
            <span className={`w ${x.doneAt ? "faint" : ""}`}><b style={x.doneAt ? { textDecoration: "line-through" } : undefined}>{x.title}</b><span>{x.dueDate ? dayCompact(x.dueDate) : "ohne Datum"}{x.doneAt ? " · erledigt" : ""}</span></span>
            <span className="a"><Icon n="chev" className="go" /></span>
          </Link>
        ))}
      </div>
      <div className="card">
        <h2>Notiz</h2>
        <textarea className="inp" style={{ width: "100%", minHeight: 110, padding: 12, marginBottom: 12, height: "auto" }} aria-label="Notiz" placeholder="Eigene Notiz" maxLength={4000} value={notes}
          onChange={(ev) => setNotes(ev.target.value)} onBlur={() => { const v = notes.trim() || null; if (v !== (t.notes ?? null)) saveNotes.mutate({ topicId: t.id, notes: v }); }} />
      </div>
      <div className="card">
        <h2>Zusammenfassung</h2>
        {t.summary ? <p className="orig" style={{ color: "var(--fg)", userSelect: "text" }}>{t.summary}</p> : <div className="empty" style={{ padding: "6px 0 16px" }}><span className="faint">–</span></div>}
      </div>
    </Stage>
  );
}
