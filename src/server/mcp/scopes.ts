// Rechte (Scopes) des MCP-Connectors. Jedes Werkzeug verlangt genau ein Recht.

export const SCOPES = ["tasks", "calendar", "school", "gym", "money:read", "health:read"] as const;
export type Scope = (typeof SCOPES)[number];

/** Beschreibung auf der Zustimmungsseite. */
export const SCOPE_LABELS: Record<Scope, string> = {
  tasks: "Aufgaben lesen, anlegen, ändern und abhaken",
  calendar: "Termine lesen",
  school: "Prüfungen und Noten lesen und neue eintragen",
  gym: "Trainings lesen und eintragen",
  "money:read": "Geld: nur Zusammenfassungen lesen (keine Einzelbuchungen)",
  "health:read": "Körper: nur Zusammenfassungen lesen",
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
  gym_week: "gym",
  log_workout: "gym",
  money_summary: "money:read",
  health_summary: "health:read",
} as const satisfies Record<string, Scope>;

export type ToolName = keyof typeof TOOL_SCOPES;
