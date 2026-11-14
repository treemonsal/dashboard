import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { checkCalendarUrl, maskCalendarUrl } from "../src/shared/calendar-url";
import { duplicatesExam, eventsOnDay, isHomework, timeLabel, visibleEvents } from "../src/shared/agenda";
import type { CalendarEvent, CalendarInfo, CalendarSyncResult } from "../src/shared/schemas";
import { syncCalendars } from "../src/server/calendar";
import { addDays, todayInZone } from "../src/shared/dates";

const GOOD = "https://calendar.google.com/calendar/ical/geheim%40group.calendar.google.com/private-0123456789abcdef/basic.ics";

describe("Kalender-Adresse", () => {
  it("nimmt nur https-Adressen von calendar.google.com an", () => {
    expect(checkCalendarUrl(GOOD).ok).toBe(true);
    expect(checkCalendarUrl("  " + GOOD + "  ").ok).toBe(true);
    for (const bad of [
      "http://calendar.google.com/calendar/ical/x/basic.ics",
      "https://example.com/calendar/ical/x/basic.ics",
      "https://calendar.google.com.evil.com/calendar/ical/x/basic.ics",
      "https://user:pw@calendar.google.com/calendar/ical/x/basic.ics",
      "https://calendar.google.com:8443/calendar/ical/x/basic.ics",
      "https://calendar.google.com/calendar/u/0/r",
      "ftp://calendar.google.com/calendar/ical/x/basic.ics",
      "kein url",
      "",
    ]) expect(checkCalendarUrl(bad).ok, bad).toBe(false);
  });
  it("localhost nur mit ausdrücklicher Freigabe", () => {
    expect(checkCalendarUrl("http://localhost:8787/x.ics").ok).toBe(false);
    expect(checkCalendarUrl("http://localhost:8787/x.ics", true).ok).toBe(true);
    expect(checkCalendarUrl("http://evil.example/x.ics", true).ok).toBe(false);
  });
  it("kürzt ohne den geheimen Teil", () => {
    const m = maskCalendarUrl(GOOD);
    expect(m).toBe("calendar.google.com/…/basic.ics");
    expect(m).not.toContain("geheim");
    expect(m).not.toContain("0123456789abcdef");
  });
});

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: "x", calendarId: "c", calendarName: "K", uid: "u", title: "T", startDate: "2026-11-16", startTime: "10:00", endDate: "2026-11-16", endTime: "11:00",
  allDay: false, location: null, description: null, ...o,
});

describe("Termine im Tagesplan", () => {
  it("blendet Hausaufgaben aus, wenn der Schalter an ist", () => {
    expect(isHomework("Hausaufgabe Mathe")).toBe(true);
    expect(isHomework("  hausaufgaben E")).toBe(true);
    expect(isHomework("Mathe Hausaufgabe")).toBe(false);
    const list = [ev({ title: "Hausaufgabe Mathe" }), ev({ title: "Zahnarzt" })];
    expect(visibleEvents(list, { hideHomework: true, exams: [] }).map((e) => e.title)).toEqual(["Zahnarzt"]);
    expect(visibleEvents(list, { hideHomework: false, exams: [] })).toHaveLength(2);
  });
  it("zeigt Prüfungen nicht doppelt, wenn dieselbe in exams steht", () => {
    const exams = [{ date: "2026-11-16", subjectCode: "FRW", subjectName: "Finanz- und Rechnungswesen" }];
    expect(duplicatesExam("Prüfung FRW", "2026-11-16", exams)).toBe(true);
    expect(duplicatesExam("FRW Pruefung", "2026-11-16", exams)).toBe(true);
    expect(duplicatesExam("Prüfung Finanz- und Rechnungswesen", "2026-11-16", exams)).toBe(true);
    expect(duplicatesExam("Prüfung FRW", "2026-11-17", exams)).toBe(false);
    expect(duplicatesExam("Prüfung E", "2026-11-16", exams)).toBe(false);
    expect(duplicatesExam("Prüfung FRWX", "2026-11-16", exams)).toBe(false);
    expect(duplicatesExam("FRW Repetition", "2026-11-16", exams)).toBe(false);
  });
  it("ordnet Termine einem Tag zu: ganztägig zuerst, dann nach Beginn, mehrtägig an jedem Tag", () => {
    const list = [
      ev({ title: "B", startTime: "14:00", endTime: "15:00" }),
      ev({ title: "A", startTime: "08:00", endTime: "09:30" }),
      ev({ title: "Ferien", allDay: true, startTime: null, endTime: null, startDate: "2026-11-15", endDate: "2026-11-18" }),
      ev({ title: "Anderer Tag", startDate: "2026-11-17", endDate: "2026-11-17" }),
    ];
    const day = eventsOnDay(list, "2026-11-16");
    expect(day.map((d) => d.event.title)).toEqual(["Ferien", "A", "B"]);
    expect(timeLabel(day[0])).toBe("ganztägig");
    expect(timeLabel(day[1])).toBe("08:00–09:30");
    expect(eventsOnDay(list, "2026-11-19")).toEqual([]);
  });
  it("Termin über Mitternacht: Beginn am ersten, Ende am zweiten Tag", () => {
    const list = [ev({ title: "Nacht", startTime: "22:00", endDate: "2026-11-17", endTime: "02:00" })];
    expect(timeLabel(eventsOnDay(list, "2026-11-16")[0])).toBe("22:00");
    expect(timeLabel(eventsOnDay(list, "2026-11-17")[0])).toBe("bis 02:00");
  });
  it("ganztägiger Termin mit exklusivem Ende (Google) zählt den Endtag nicht mit", () => {
    // Im Leser ist endDate bereits der letzte Tag; Mitternacht-Ende wird hier abgefangen.
    const list = [ev({ title: "Zwei Tage", startTime: "00:00", endDate: "2026-11-18", endTime: "00:00" })];
    expect(eventsOnDay(list, "2026-11-17")).toHaveLength(1);
    expect(eventsOnDay(list, "2026-11-18")).toHaveLength(0);
  });
});

const ics = (title: string, date: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${title}@x\r\nDTSTART;VALUE=DATE:${date.replaceAll("-", "")}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}

describe("Kalender-Routen und Abgleich", () => {
  const today = todayInZone();
  const fetcherOf = (text: string, status = 200) => (async () => new Response(text, { status })) as unknown as typeof fetch;

  it("speichert die Adresse, zeigt sie nur gekürzt und weist fremde Adressen ab", async () => {
    expect((await call("POST", "/api/calendars", { name: "Schule", url: "https://example.com/x.ics" })).status).toBe(400);
    const r = await call<CalendarInfo>("POST", "/api/calendars", { id: "cal-1", name: "Schule", url: GOOD });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.data)).not.toContain("geheim");
    const list = await call<CalendarInfo[]>("GET", "/api/calendars");
    expect(list.data).toEqual([{ id: "cal-1", name: "Schule", urlMasked: "calendar.google.com/…/basic.ics" }]);
    expect(JSON.stringify(list.data)).not.toContain("0123456789abcdef");
  });

  it("gleicht ab, schreibt Termine und sync_runs, ersetzt beim zweiten Lauf", async () => {
    const r1 = await syncCalendars(env, { fetcher: fetcherOf(ics("Zahnarzt", today)) });
    expect(r1).toMatchObject({ ok: true, events: 1 });
    let events = await call<CalendarEvent[]>("GET", `/api/calendar/events?from=${today}&to=${addDays(today, 1)}`);
    expect(events.data.map((e) => e.title)).toEqual(["Zahnarzt"]);
    expect(events.data[0]).toMatchObject({ allDay: true, calendarName: "Schule" });

    await syncCalendars(env, { fetcher: fetcherOf(ics("Kino", today)) });
    events = await call<CalendarEvent[]>("GET", `/api/calendar/events?from=${today}&to=${addDays(today, 1)}`);
    expect(events.data.map((e) => e.title)).toEqual(["Kino"]);

    const runs = await call<{ kind: string; ok: boolean; message: string }[]>("GET", "/api/sync-runs?kind=kalender");
    expect(runs.data.length).toBeGreaterThanOrEqual(2);
    expect(runs.data[0]).toMatchObject({ kind: "kalender", ok: true, message: "1 Termin" });
  });

  it("meldet Fehler ehrlich, ohne die Adresse, und behält die alten Termine", async () => {
    const r = await syncCalendars(env, { fetcher: fetcherOf("nicht gefunden", 404) });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Schule");
    expect(r.message).toContain("404");
    expect(r.message).not.toContain("geheim");
    const events = await call<CalendarEvent[]>("GET", `/api/calendar/events?from=${today}&to=${addDays(today, 1)}`);
    expect(events.data.map((e) => e.title)).toEqual(["Kino"]);

    const html = await syncCalendars(env, { fetcher: fetcherOf("<html>Anmelden</html>") });
    expect(html.ok).toBe(false);
    expect(html.message).toContain("keine Kalenderdatei");

    const net = await syncCalendars(env, { fetcher: (async () => { throw new TypeError("fetch failed " + GOOD); }) as unknown as typeof fetch });
    expect(net.ok).toBe(false);
    expect(net.message).not.toContain("geheim");

    const runs = await call<{ ok: boolean; message: string }[]>("GET", "/api/sync-runs?kind=kalender");
    expect(runs.data[0].ok).toBe(false);
    expect(JSON.stringify(runs.data)).not.toContain("geheim");
  });

  it("folgt Weiterleitungen nur auf erlaubte Adressen", async () => {
    const evil = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.ics" } })) as unknown as typeof fetch;
    const r = await syncCalendars(env, { fetcher: evil });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Weiterleitung nicht erlaubt");
  });

  it("Export enthält weder Adresse noch Kalender", async () => {
    const res = await exports.default.fetch("http://localhost/api/export");
    const text = await res.text();
    expect(text).not.toContain("geheim");
    expect(text).not.toContain("calendar.google.com");
  });

  it("Löschen entfernt Kalender und seine Termine", async () => {
    expect((await call("DELETE", "/api/calendars/cal-1")).status).toBe(200);
    expect((await call("DELETE", "/api/calendars/cal-1")).status).toBe(404);
    const events = await call<CalendarEvent[]>("GET", `/api/calendar/events?from=${today}&to=${addDays(today, 1)}`);
    expect(events.data).toEqual([]);
    const r = await syncCalendars(env, {});
    expect(r).toEqual({ ok: true, message: "Kein Kalender eingetragen", events: 0 });
  });

  it("Route Jetzt abgleichen liefert das Ergebnis", async () => {
    const r = await call<CalendarSyncResult>("POST", "/api/calendar/sync");
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });
});

describe("Erinnerungen: Routen", () => {
  it("Abo anlegen, doppelt gleiche Adresse bleibt eins, abmelden", async () => {
    const sub = { endpoint: "https://web.push.apple.com/wpush/v2/abc", keys: { p256dh: "B".padEnd(87, "x"), auth: "a".repeat(22) } };
    expect((await call("POST", "/api/push/subscribe", sub)).status).toBe(201);
    expect((await call("POST", "/api/push/subscribe", sub)).status).toBe(201);
    expect((await call<{ count: number }>("GET", "/api/push/status")).data.count).toBe(1);
    expect((await call("POST", "/api/push/subscribe", { ...sub, endpoint: "http://insecure.example/x" })).status).toBe(400);
    expect((await call("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint })).status).toBe(200);
    expect((await call<{ count: number }>("GET", "/api/push/status")).data.count).toBe(0);
  });
  it("Test-Erinnerung ohne Schlüssel meldet 503", async () => {
    expect((await call("POST", "/api/push/test")).status).toBe(503);
  });
});
