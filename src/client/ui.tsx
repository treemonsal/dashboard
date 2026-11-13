// Schlichte Bausteine. Werte kommen aus tokens.css über Tailwind-Klassen.
import type { ReactNode } from "react";
import { daysUntil, dayShort, inDays } from "../shared/dates";
import type { Exam, Task } from "../shared/schemas";
import { Link } from "./router";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="pb-4 border-b border-line">
      {eyebrow && <div className="font-mono text-xs uppercase tracking-wider text-muted">{eyebrow}</div>}
      <h1 className="font-display text-[length:var(--text-xl)] font-semibold leading-tight mt-1 break-words">{title}</h1>
      {children}
    </header>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-muted border-y border-line">{children}</p>;
}

/** Platzhalter statt Ladekreisel. */
export function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div aria-hidden="true" className="border-t border-line">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-line">
          <span className="skeleton h-4 w-4 rounded-full" />
          <span className="skeleton h-3 flex-1" />
          <span className="skeleton h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="py-3 text-sm text-warn">Konnte nicht geladen werden: {error instanceof Error ? error.message : "unbekannter Fehler"}</p>;
}

export function TaskRow({ task, onToggle }: { task: Task; onToggle: (done: boolean) => void }) {
  const done = task.doneAt !== null;
  const meta = task.durationMin ? `${task.durationMin} min` : task.dueTime ? task.dueTime : task.dueDate ? dayShort(task.dueDate) : "";
  return (
    <button
      type="button"
      aria-pressed={done}
      onClick={() => onToggle(!done)}
      className="w-full grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 py-3 border-b border-line text-left"
    >
      <span
        className={`h-[18px] w-[18px] rounded-full border-[1.5px] grid place-items-center transition-colors duration-[var(--duration)] ${done ? "bg-accent border-accent" : "border-muted"}`}
      >
        {done && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5.2 4.2 7.4 8 3" stroke="var(--color-accent-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={`min-w-0 break-words ${done ? "line-through text-muted" : ""}`}>{task.title}</span>
      <span className="font-mono text-xs text-muted tabular-nums whitespace-nowrap">{meta}</span>
    </button>
  );
}

export function TaskList({ tasks, onToggle }: { tasks: Task[]; onToggle: (id: string, done: boolean) => void }) {
  return (
    <div className="border-t border-line">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onToggle={(d) => onToggle(t.id, d)} />
      ))}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block ml-2 px-1.5 text-xs text-warn border border-warn rounded-sm whitespace-nowrap align-middle">{children}</span>;
}

export function ExamRow({ exam }: { exam: Exam }) {
  const n = daysUntil(exam.date);
  return (
    <Link
      href={`/schule/pruefungen/${exam.id}`}
      className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-3 border-b border-line no-underline text-ink"
    >
      <span className="font-mono text-xs text-muted tabular-nums whitespace-nowrap">{dayShort(exam.date)}</span>
      <span className="min-w-0 break-words">
        <span className="font-medium">{exam.subjectCode}</span> <span className="text-muted">{exam.title}</span>
        {exam.status === "unbestaetigt" && <Chip>unbestätigt</Chip>}
        {exam.hint && <Chip>{exam.hint}</Chip>}
      </span>
      <span className="font-display text-lg font-semibold tabular-nums text-right" aria-label={inDays(n)}>
        {n}
        <small className="font-mono text-xs text-muted font-normal ml-1">T</small>
      </span>
    </Link>
  );
}
