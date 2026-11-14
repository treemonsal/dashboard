// Stundenplan: wöchentliche Lektionen, Auswahl für einen Tag und Zusammenfassen zu Blöcken. Reine Funktionen.
import { minutesOf, weekdayNum } from "./dates";

export interface Lesson {
  /** 1 = Montag ... 7 = Sonntag */
  weekday: number;
  startTime: string;
  endTime: string;
  /** Fach-Kürzel als Text, z.B. "W+R" */
  subject: string;
  room: string | null;
  teacher: string | null;
  /** Gültig ab (YYYY-MM-DD), null = von Anfang an */
  validFrom: string | null;
}

/** Ein Block im Tagesplan: aufeinanderfolgende Lektionen desselben Fachs. */
export interface LessonBlock {
  subject: string;
  startMin: number;
  endMin: number;
  /** Zimmer und Lehrperson der ersten Lektion des Blocks */
  room: string | null;
  teacher: string | null;
  lessons: number;
}

/** Pause zwischen zwei Lektionen, die noch als "aufeinanderfolgend" gilt (Minuten). */
export const MERGE_GAP = 10;

/** Wochentag eines Datums als 1 (Montag) bis 7 (Sonntag). */
export const isoWeekday = (day: string) => weekdayNum(day) || 7;

/**
 * Die Lektionen, die an einem Datum gelten: passender Wochentag und nur die Fassung mit dem
 * jüngsten "gültig ab" bis zu diesem Tag (so ersetzt ein neuer Stundenplan den alten, ohne dass der alte gelöscht werden muss).
 * `holidayUntil`: bis und mit diesem Datum sind Schulferien, es gibt keine Lektionen.
 */
export function lessonsOn(lessons: Lesson[], day: string, holidayUntil?: string | null): Lesson[] {
  if (holidayUntil && day <= holidayUntil) return [];
  const live = lessons.filter((l) => !l.validFrom || l.validFrom <= day);
  if (!live.length) return [];
  const version = live.reduce((m, l) => (l.validFrom ?? "") > m ? (l.validFrom ?? "") : m, "");
  return live.filter((l) => (l.validFrom ?? "") === version && l.weekday === isoWeekday(day));
}

/** Lektionen eines Tages zu Blöcken zusammenfassen, nach Beginn sortiert. */
export function lessonBlocks(day: Lesson[]): LessonBlock[] {
  const sorted = [...day].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime) || minutesOf(a.endTime) - minutesOf(b.endTime));
  const out: LessonBlock[] = [];
  for (const l of sorted) {
    const s = minutesOf(l.startTime);
    const e = minutesOf(l.endTime);
    const last = out[out.length - 1];
    if (last && last.subject === l.subject && s - last.endMin <= MERGE_GAP && s >= last.startMin) {
      last.endMin = Math.max(last.endMin, e);
      last.lessons++;
    } else out.push({ subject: l.subject, startMin: s, endMin: e, room: l.room, teacher: l.teacher, lessons: 1 });
  }
  return out;
}

/** Blöcke eines Datums (Ferien und Fassungen berücksichtigt). */
export const blocksOn = (lessons: Lesson[], day: string, holidayUntil?: string | null) => lessonBlocks(lessonsOn(lessons, day, holidayUntil));
