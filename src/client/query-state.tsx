import { ApiError } from "./api";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Bitte erneut anmelden.";
  if (error instanceof ApiError && error.status === 403) return "Für diese Änderung fehlt die Berechtigung.";
  if (error instanceof TypeError) return "Verbindung prüfen und erneut versuchen.";
  return error instanceof Error && error.message ? error.message : "Bitte erneut versuchen.";
}

export function QueryNotice({ pending, error }: { pending?: boolean; error?: unknown }) {
  if (error) return <p className="empty warn" role="alert">Daten konnten nicht geladen werden. {errorMessage(error)}</p>;
  if (pending) return <p className="empty" role="status">Daten werden geladen.</p>;
  return null;
}

export function SaveNotice({ error }: { error: unknown }) {
  return error ? <p className="warn" role="alert">Nicht gespeichert. {errorMessage(error)} Deine Eingabe bleibt erhalten.</p> : null;
}
