// Rechte (Scopes) des MCP-Connectors. Jedes Werkzeug verlangt genau ein Recht.

export const SCOPES = ["tasks", "calendar", "school", "gym", "money:read", "health:read", "notify"] as const;
export type Scope = (typeof SCOPES)[number];

/** Beschreibung auf der Zustimmungsseite. */
export const SCOPE_LABELS: Record<Scope, string> = {
  tasks: "Aufgaben lesen, anlegen, ändern und abhaken",
  calendar: "Termine lesen",
  school: "Prüfungen, Noten und Stundenplan lesen, Noten eintragen und den Stundenplan ersetzen",
  gym: "Trainings lesen und eintragen",
  "money:read": "Geld: nur Zusammenfassungen lesen (keine Einzelbuchungen)",
  "health:read": "Körper: nur Zusammenfassungen lesen",
  notify: "Mitteilungen aufs Handy schicken (höchstens 10 pro Tag)",
};

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

/** Welches Recht ein Werkzeug braucht. Wird vor dem MCP-SDK geprüft (403 insufficient_scope). */
export const TOOL_SCOPES = {
  today_overview: "tasks",
  list_tasks: "tasks",
  add_task: "tasks",
  update_task: "tasks",
  complete_task: "tasks",
  list_events: "calendar",
  list_exams: "school",
  add_exam: "school",
  set_exam_topics: "school",
  list_grades: "school",
  add_grade: "school",
  grade_summary: "school",
  get_timetable: "school",
  set_timetable: "school",
  gym_week: "gym",
  log_workout: "gym",
  money_summary: "money:read",
  health_summary: "health:read",
  notify: "notify",
} as const satisfies Record<string, Scope>;

export type ToolName = keyof typeof TOOL_SCOPES;
