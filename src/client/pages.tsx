import { useState, type FormEvent } from "react";
import { clusterAfterNext, dayMonthLong, dayShort, daysUntil, inDays, isoWeek, numberWord, todayInZone, weekdayLong } from "../shared/dates";
import { weightedAverage } from "../shared/calc";
import type { Assessment, SyncRun } from "../shared/schemas";
import { useCreateTask, useExam, useExams, useGrades, useLastSync, useSetAssessment, useSetExamStatus, useTasks, useToggleTask } from "./queries";
import { Link } from "./router";
import { Chip, Empty, ErrorNote, ExamRow, PageHeader, Section, SkeletonRows, TaskList } from "./ui";

function lastSyncText(runs: SyncRun[] | undefined): string {
  const r = runs?.[0];
  if (!r) return "Schulabgleich: noch kein Lauf.";
  const when = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" }).format(new Date(r.at));
  return r.ok ? `Letzter Schulabgleich: ${when}.` : `Schulabgleich am ${when} fehlgeschlagen: ${r.message ?? "ohne Meldung"}.`;
}

export function Heute() {
  const today = todayInZone();
  const tasks = useTasks("today");
  const exams = useExams();
  const grades = useGrades();
  const sync = useLastSync("schule");
  const toggle = useToggleTask();

  const upcoming = exams.data ?? [];
  const next = upcoming[0];
  const cluster = clusterAfterNext(upcoming);
  const avg = weightedAverage(grades.data ?? []);

  return (
    <div className="view">
      <PageHeader eyebrow={`${weekdayLong(today)} · KW ${isoWeek(today)}`} title={dayMonthLong(today)}>
        {next && (
          <p className="mt-3 text-sm text-muted">
            Nächste Prüfung {inDays(daysUntil(next.date))}: <span className="text-ink">{next.subjectCode}, {next.title}</span>.
            {cluster && ` Danach ${numberWord(cluster.count)} Prüfungen in ${numberWord(cluster.spanDays)} Tagen.`}
          </p>
        )}
      </PageHeader>

      <Section title="Fällig">
        {tasks.isPending ? (
          <SkeletonRows />
        ) : tasks.isError ? (
          <ErrorNote error={tasks.error} />
        ) : tasks.data.length === 0 ? (
          <Empty>Keine Aufgaben für heute.</Empty>
        ) : (
          <TaskList tasks={tasks.data} onToggle={(id, done) => toggle.mutate({ id, done })} />
        )}
      </Section>

      <Section title="Prüfungen" aside="aus dem Kalender">
        {exams.isPending ? (
          <SkeletonRows n={4} />
        ) : exams.isError ? (
          <ErrorNote error={exams.error} />
        ) : upcoming.length === 0 ? (
          <Empty>Keine kommenden Prüfungen.</Empty>
        ) : (
          <div className="border-t border-line">{upcoming.slice(0, 6).map((e) => <ExamRow key={e.id} exam={e} />)}</div>
        )}
      </Section>

      <Section title="Stand">
        <dl className="border-t border-line text-sm">
          <Stat label="Notenschnitt" value={avg === null ? null : avg.toFixed(2)} empty={grades.isPending ? "" : "noch keine Noten"} />
          <Stat label="Schlaf letzte Nacht" value={null} empty="Gesundheit ist noch nicht verbunden" />
          <Stat label="Übrig bis Monatsende" value={null} empty="Finanzen sind noch nicht verbunden" />
        </dl>
        <p className="mt-2 text-xs text-muted">{sync.isPending ? " " : lastSyncText(sync.data)}</p>
      </Section>
    </div>
  );
}

function Stat({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3 border-b border-line">
      <dt className="text-muted">{label}</dt>
      <dd className={value === null ? "text-muted text-right" : "font-display text-lg font-semibold tabular-nums"}>{value ?? empty}</dd>
    </div>
  );
}

export function Aufgaben() {
  const tasks = useTasks("all");
  const toggle = useToggleTask();
  const create = useCreateTask();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    create.mutate({ id: crypto.randomUUID(), title: t, dueDate: due || null });
    setTitle("");
  }

  const list = (tasks.data ?? []).filter((t) => !t.parentId);
  return (
    <div className="view">
      <PageHeader title="Aufgaben" />
      <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="new-task">
          Neue Aufgabe
        </label>
        <input
          id="new-task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Neue Aufgabe"
          maxLength={500}
          className="flex-1 min-w-0 basis-48 bg-surface border border-line rounded-md px-3 py-2 text-base placeholder:text-muted"
        />
        <label className="sr-only" htmlFor="new-task-due">
          Fällig am
        </label>
        <input id="new-task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="bg-surface border border-line rounded-md px-3 py-2 text-base" />
        <button type="submit" className="rounded-md px-4 py-2 bg-accent text-accent-ink font-medium">
          Hinzufügen
        </button>
      </form>
      {create.isError && <ErrorNote error={create.error} />}
      <Section title="Offen">
        {tasks.isPending ? (
          <SkeletonRows />
        ) : tasks.isError ? (
          <ErrorNote error={tasks.error} />
        ) : list.length === 0 ? (
          <Empty>Noch keine Aufgaben.</Empty>
        ) : (
          <TaskList tasks={list} onToggle={(id, done) => toggle.mutate({ id, done })} />
        )}
      </Section>
    </div>
  );
}

export function Schule() {
  const exams = useExams();
  const grades = useGrades();
  return (
    <div className="view">
      <PageHeader title="Schule" />
      <Section title="Prüfungen">
        {exams.isPending ? (
          <SkeletonRows n={4} />
        ) : exams.isError ? (
          <ErrorNote error={exams.error} />
        ) : exams.data.length === 0 ? (
          <Empty>Keine kommenden Prüfungen.</Empty>
        ) : (
          <div className="border-t border-line">{exams.data.map((e) => <ExamRow key={e.id} exam={e} />)}</div>
        )}
      </Section>
      <Section title="Noten">
        {grades.isPending ? (
          <SkeletonRows n={2} />
        ) : grades.isError ? (
          <ErrorNote error={grades.error} />
        ) : grades.data.length === 0 ? (
          <Empty>Noch keine Noten erfasst.</Empty>
        ) : (
          <div className="border-t border-line">
            {grades.data.map((g) => (
              <div key={g.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] gap-3 py-3 border-b border-line">
                <span className="font-mono text-xs text-muted">{dayShort(g.date)}</span>
                <span className="min-w-0 break-words">{g.title ?? "Note"}</span>
                <span className="tabular-nums">{g.value}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

const LEVELS: { v: Assessment; label: string }[] = [
  { v: 0, label: "offen" },
  { v: 1, label: "unsicher" },
  { v: 2, label: "sitzt" },
];

export function Pruefung({ id }: { id: string }) {
  const exam = useExam(id);
  const setAssessment = useSetAssessment(id);
  const setStatus = useSetExamStatus(id);

  if (exam.isPending)
    return (
      <div className="view">
        <div className="skeleton h-3 w-24 mt-2" />
        <div className="skeleton h-7 w-3/4 mt-3 mb-4" />
        <SkeletonRows n={4} />
      </div>
    );
  if (exam.isError) return <ErrorNote error={exam.error} />;
  const e = exam.data;
  const n = daysUntil(e.date);
  const time = e.startTime ? `${e.startTime}${e.endTime ? ` bis ${e.endTime}` : ""}` : "offen";

  return (
    <div className="view">
      <Link href="/schule" className="inline-block mb-3 text-sm text-muted no-underline">
        Zurück zu Schule
      </Link>
      <PageHeader eyebrow={`${e.subjectCode} · ${dayShort(e.date)}`} title={e.title}>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Fact label="bis zur Prüfung" value={n >= 0 ? `${n} Tage` : "vorbei"} />
          <Fact label="Zeit" value={time} extra={e.hint ? <Chip>{e.hint}</Chip> : null} />
          <Fact label="Zimmer" value={e.room ?? "offen"} />
        </dl>
        {e.status === "unbestaetigt" && (
          <button type="button" onClick={() => setStatus.mutate("bestaetigt")} className="mt-4 rounded-md px-4 py-2 border border-ink font-medium">
            Prüfung bestätigen
          </button>
        )}
      </PageHeader>

      <Section title="Was drankommt" aside={`${e.topicsSolid} von ${e.topics.length} sitzen`}>
        {e.topics.length === 0 ? (
          <Empty>Noch keine Themen erfasst.</Empty>
        ) : (
          <div className="border-t border-line">
            {e.topics.map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 border-b border-line">
                <span className="min-w-0 break-words">{t.title}</span>
                <span role="group" aria-label={`Einschätzung ${t.title}`} className="flex border border-line rounded-md overflow-hidden">
                  {LEVELS.map((l) => (
                    <button
                      key={l.v}
                      type="button"
                      aria-pressed={t.assessment === l.v}
                      onClick={() => setAssessment.mutate({ topicId: t.id, assessment: l.v })}
                      className={`px-2.5 py-1 text-xs [&+&]:border-l border-line transition-colors duration-[var(--duration)] ${t.assessment === l.v ? "bg-accent text-accent-ink font-medium" : "text-muted"}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {e.source && <p className="mt-2 text-xs text-muted">Quelle: {e.source}</p>}
      </Section>
    </div>
  );
}

function Fact({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="font-medium break-words">
        {value}
        {extra}
      </dd>
    </div>
  );
}

export function Leer({ title, text }: { title: string; text: string }) {
  return (
    <div className="view">
      <PageHeader title={title} />
      <p className="py-6 text-sm text-muted max-w-prose">{text}</p>
    </div>
  );
}
