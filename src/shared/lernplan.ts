// Lernblöcke rückwärts ab Prüfungsdatum. Reine Funktion, damit sie sich testen lässt.
import { addDays, daysBetween } from "./dates";

export interface StudyTopic {
  title: string;
  /** 0 = offen, 1 = unsicher, 2 = sitzt */
  assessment: number;
}

export interface StudyBlock {
  date: string;
  title: string;
  durationMin: number;
}

export interface StudyPlanInput {
  subject: string;
  examDate: string;
  today: string;
  topics: StudyTopic[];
  /** Tage, an denen schon eine andere Prüfung stattfindet: dort wird nicht eingeplant. */
  busyDays?: string[];
  blockMin?: number;
  /** Wie viele Tage vor der Prüfung frühestens begonnen wird. */
  lookbackDays?: number;
}

/**
 * Jedes Thema, das nicht sitzt, bekommt einen Block (zuerst durchgehen). Offene Themen kommen ein zweites Mal
 * als Repetition. Die Blöcke werden gleichmässig auf die freien Tage verteilt, der letzte liegt am Tag vor der Prüfung.
 */
export function planStudyBlocks(i: StudyPlanInput): StudyBlock[] {
  const blockMin = i.blockMin ?? 40;
  const first = i.topics.filter((t) => t.assessment < 2);
  const again = i.topics.filter((t) => t.assessment === 0);
  const seq = [
    ...first.map((t) => ({ title: `${i.subject} lernen: ${t.title}` })),
    ...again.map((t) => ({ title: `${i.subject} repetieren: ${t.title}` })),
  ];
  if (!seq.length) return [];

  const busy = new Set(i.busyDays ?? []);
  const start = addDays(i.examDate, -(i.lookbackDays ?? 14));
  const from = start > i.today ? start : i.today;
  const days: string[] = [];
  for (let d = from; daysBetween(d, i.examDate) >= 1; d = addDays(d, 1)) if (!busy.has(d)) days.push(d);
  if (!days.length) return [];

  const k = seq.length;
  const n = days.length;
  return seq.map((b, idx) => {
    const di = k <= n ? n - 1 - Math.floor(((k - 1 - idx) * n) / k) : Math.floor((idx * n) / k);
    return { date: days[di], title: b.title, durationMin: blockMin };
  });
}
