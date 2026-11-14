// Die geheime iCal-Adresse von Google Kalender ist ein Zugangsschlüssel. Diese Datei prüft sie und
// liefert eine gekürzte Anzeige. Die volle Adresse verlässt den Server nie.

export const CALENDAR_HOST = "calendar.google.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Nur https-Adressen von calendar.google.com unter /calendar/ical/.
 * `allowLocal` gilt ausschliesslich für Tests und lokale Entwicklung und nur für localhost.
 */
export function checkCalendarUrl(raw: string, allowLocal = false): UrlCheck {
  const text = raw.trim();
  if (!text || text.length > 2000) return { ok: false, reason: "Adresse fehlt oder ist zu lang" };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: "Keine gültige Adresse" };
  }
  if (allowLocal && LOCAL_HOSTS.has(u.hostname) && (u.protocol === "http:" || u.protocol === "https:")) return { ok: true, url: u.toString() };
  if (u.protocol !== "https:") return { ok: false, reason: "Nur https-Adressen" };
  if (u.hostname !== CALENDAR_HOST) return { ok: false, reason: "Nur Adressen von calendar.google.com" };
  if (u.username || u.password || (u.port && u.port !== "443")) return { ok: false, reason: "Ungültige Adresse" };
  if (!u.pathname.startsWith("/calendar/ical/")) return { ok: false, reason: "Das ist nicht die geheime iCal-Adresse" };
  return { ok: true, url: u.toString() };
}

/** "calendar.google.com/…/basic.ics": Host und Dateiname, nie der geheime Teil. */
export function maskCalendarUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return `${u.host}/…${/^[A-Za-z]+\.ics$/.test(last) ? `/${last}` : ""}`;
  } catch {
    return "…";
  }
}
