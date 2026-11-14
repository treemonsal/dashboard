// Termine aus dem Kalender für Heute und Woche: Auswahl, Ausblenden und Zuordnung zu Tagen.
import { addDays, minutesOf } from "./dates";
import type { CalendarEvent } from "./schemas";

/** Titel, die mit "Hausaufgabe" beginnen (auch "Hausaufgaben"), Gross-/Kleinschreibung egal. */
export const isHomework = (title: string) => /^\s*hausaufgabe/i.test(title);
export const mentionsExam = (title: string) => /pr(?:ü|ue|u)fung/i.test(title);

export interface ExamRef {
  date: string;
  subjectCode: string;
  subjectName?: string | null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, "iu");

/** "Prüfung" im Titel und am selben Tag schon eine Prüfung desselben Fachs (Kürzel oder Name im Titel). */
export function duplicatesExam(title: string, date: string, exams: ExamRef[]): boolean {
  if (!mentionsExam(title)) return false;
  return exams.some((e) => e.date === date && (word(e.subjectCode).test(title) || (!!e.subjectName && word(e.subjectName).test(title))));
}

export interface AgendaOptions {
  hideHomework: boolean;
  exams: ExamRef[];
}

/** Termine, die angezeigt werden sollen. Bei mehrtägigen Terminen zählt der Starttag für die Prüfungs-Dublette. */
export function visibleEvents(events: CalendarEvent[], o: AgendaOptions): CalendarEvent[] {
  return events.filter((e) => !(o.hideHomework && isHomework(e.title)) && !duplicatesExam(e.title, e.startDate, o.exams));
}

/** Eintrag eines Termins an einem bestimmten Tag. */
export interface DayEvent {
  event: CalendarEvent;
  /** Minuten seit Mitternacht, null = ganztägig oder läuft den ganzen Tag. */
  startMin: number | null;
  endMin: number | null;
  allDay: boolean;
}

export function lastDayOf(e: CalendarEvent): string {
  if (!e.allDay && e.endTime === "00:00" && e.endDate > e.startDate) return addDays(e.endDate, -1);
  return e.endDate < e.startDate ? e.startDate : e.endDate;
}

/** Termine eines Tages: ganztägige zuerst, dann nach Beginn. */
export function eventsOnDay(events: CalendarEvent[], day: string): DayEvent[] {
  const out: DayEvent[] = [];
  for (const e of events) {
    if (e.startDate > day || lastDayOf(e) < day) continue;
    if (e.allDay) out.push({ event: e, startMin: null, endMin: null, allDay: true });
    else if (e.startDate === day) {
      const sameDay = e.endDate === day;
      out.push({ event: e, startMin: minutesOf(e.startTime!), endMin: sameDay && e.endTime ? minutesOf(e.endTime) : null, allDay: false });
    } else out.push({ event: e, startMin: null, endMin: e.endDate === day && e.endTime ? minutesOf(e.endTime) : null, allDay: true });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startMin ?? 0) - (b.startMin ?? 0) || a.event.title.localeCompare(b.event.title));
}

/** "08:15–09:00", "ganztägig", "bis 11:00" */
export function timeLabel(d: DayEvent): string {
  const c = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (d.startMin !== null) return d.endMin !== null && d.endMin !== d.startMin ? `${c(d.startMin)}–${c(d.endMin)}` : c(d.startMin);
  return d.endMin !== null ? `bis ${c(d.endMin)}` : "ganztägig";
}
