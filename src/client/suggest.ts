// Vorschläge fürs Tagesplan-Lernen: Daten aus task_events, Rechnung in src/shared/vorschlag.ts.
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { eventsOnDay } from "../shared/agenda";
import { minutesOf, timeInZone, weekdayNum } from "../shared/dates";
import { suggestDay, type Suggestion } from "../shared/vorschlag";
import type { CalendarEvent, Task } from "../shared/schemas";
import { useSettings, useTimetable } from "./queries";

const days = (s: string) => (s ? s.split(",").map(Number) : []);

/** Gibt eine Funktion, die für einen Tag die Vorschläge je Aufgabe liefert (leer, solange zu wenig Daten da sind). */
export function useSuggest() {
  const q = useQuery({ queryKey: ["task-events"], queryFn: api.taskEvents, staleTime: 5 * 60_000 });
  const s = useSettings();
  const tt = useTimetable();
  const events = q.data ?? [];
  return (day: string, tasks: Task[], calendar: CalendarEvent[], today: string): Map<string, Suggestion> => {
    if (day < today || events.length === 0) return new Map();
    const appointments = eventsOnDay(calendar, day)
      .filter((d) => !d.allDay && d.startMin !== null)
      .map((d) => ({ start: d.startMin!, end: d.endMin ?? d.startMin! + 30 }));
    return suggestDay({
      weekday: weekdayNum(day),
      tasks: tasks.filter((t) => t.dueDate === day && !t.parentId).map((t) => ({ id: t.id, title: t.title, dueTime: t.dueTime, durationMin: t.durationMin, done: !!t.doneAt })),
      events,
      appointments,
      workDays: days(s.workDays),
      schoolDays: days(s.schoolDays),
      wake: s.wakeTime,
      lessons: tt.has ? tt.on(day).map((b) => ({ start: b.startMin, end: b.endMin })) : null,
      from: day === today ? minutesOf(timeInZone(new Date())) : undefined,
    });
  };
}
