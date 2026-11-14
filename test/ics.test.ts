import { describe, expect, it } from "vitest";
import { IcsError, parseIcs, unfold, unescapeText } from "../src/shared/ics";

// Alle Texte sind erfunden. Fenster: November 2026 bis März 2027.
const W = { from: "2026-11-01", to: "2027-03-31" };
const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//DE\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e.trim().split("\n").map((l) => l.trim()).join("\r\n")}\r\nEND:VEVENT\r\n`).join("")}END:VCALENDAR\r\n`;
const run = (ev: string, w = W) => parseIcs(cal(ev), w);
const when = (r: ReturnType<typeof parseIcs>) => r.events.map((e) => `${e.startDate} ${e.startTime ?? "ganztägig"}`);

describe("Zeilen und Text", () => {
  it("faltet Zeilen auf (CRLF und LF, Leerzeichen und Tab)", () => {
    expect(unfold("A:eins\r\n zwei\r\nB:x\n\tdrei\nC:y")).toEqual(["A:einszwei", "B:xdrei", "C:y"]);
  });
  it("entmaskiert Text", () => {
    expect(unescapeText("a\\, b\\; c\\\\d\\nZeile")).toBe("a, b; c\\d\nZeile");
  });
  it("liest Titel, Ort und Beschreibung über gefaltete Zeilen", () => {
    const r = parseIcs(
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nDTSTART:20261120T080000Z\r\nDTEND:20261120T090000Z\r\nSUMMARY:Franz\\, Lek\r\n tion\r\nLOCATION:Zimmer 4\\;\r\n  Nord\r\nDESCRIPTION:Zeile eins\\nZeile zwei\r\nEND:VEVENT\r\nEND:VCALENDAR",
      W,
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ title: "Franz, Lektion", location: "Zimmer 4; Nord", description: "Zeile eins\nZeile zwei" });
  });
  it("lehnt Texte ohne VCALENDAR ab", () => {
    expect(() => parseIcs("<html>Anmelden</html>", W)).toThrow(IcsError);
    expect(() => parseIcs("", W)).toThrow(IcsError);
  });
  it("ignoriert VALARM und fremde Blöcke, liefert leere Liste ohne Termine", () => {
    const r = run(`UID:a
      DTSTART:20261120T080000Z
      DTEND:20261120T090000Z
      SUMMARY:Echt
      BEGIN:VALARM
      ACTION:DISPLAY
      DESCRIPTION:Erinnerung
      SUMMARY:Falsch
      END:VALARM`);
    expect(r.events[0].title).toBe("Echt");
    expect(r.events[0].description).toBeNull();
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR", W)).toEqual({ events: [], total: 0, unsupported: 0 });
  });
  it("gibt Termin ohne Titel einen Ersatz und überspringt Termine ohne gültiges Start", () => {
    const r = parseIcs(cal("UID:a\nDTSTART:20261120T080000Z", "UID:b\nDTSTART:kaputt\nSUMMARY:X", "UID:c\nSUMMARY:ohne Start"), W);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].title).toBe("(ohne Titel)");
    expect(r.total).toBe(3);
  });
  it("liest Parameter mit Anführungszeichen und Doppelpunkten", () => {
    const r = run(`UID:q
      DTSTART;TZID="Europe/Zurich":20261120T080000
      DTEND;TZID="Europe/Zurich":20261120T090000
      SUMMARY:Zeit 08:00 Uhr
      LOCATION;LANGUAGE=de:Saal: Ost`);
    expect(r.events[0]).toMatchObject({ title: "Zeit 08:00 Uhr", location: "Saal: Ost", startTime: "08:00" });
  });
});

describe("Zeitangaben und Zeitzone", () => {
  it("rechnet UTC nach Zürich (Winter +1, Sommer +2)", () => {
    const r = run(`UID:a
      DTSTART:20261120T080000Z
      DTEND:20261120T093000Z
      SUMMARY:Winter`, { from: "2026-01-01", to: "2026-12-31" });
    expect(r.events[0]).toMatchObject({ startDate: "2026-11-20", startTime: "09:00", endTime: "10:30" });
    const s = run(`UID:b
      DTSTART:20260701T080000Z
      DTEND:20260701T090000Z
      SUMMARY:Sommer`, { from: "2026-01-01", to: "2026-12-31" });
    expect(s.events[0]).toMatchObject({ startTime: "10:00", endTime: "11:00" });
  });
  it("UTC kurz vor Mitternacht rutscht auf den nächsten Zürcher Tag", () => {
    const r = run(`UID:a
      DTSTART:20261120T233000Z
      DTEND:20261121T003000Z
      SUMMARY:Spät`);
    expect(r.events[0]).toMatchObject({ startDate: "2026-11-21", startTime: "00:30", endTime: "01:30" });
  });
  it("liest TZID Europe/Zurich unverändert, auch im Sommer", () => {
    const r = run(`UID:a
      DTSTART;TZID=Europe/Zurich:20260715T130000
      DTEND;TZID=Europe/Zurich:20260715T141500
      SUMMARY:Mittag`, { from: "2026-07-01", to: "2026-07-31" });
    expect(r.events[0]).toMatchObject({ startDate: "2026-07-15", startTime: "13:00", endTime: "14:15" });
  });
  it("rechnet fremde Zonen um (New York 09:00 = Zürich 15:00, im Übergang 14:00 oder 15:00)", () => {
    const r = run(`UID:a
      DTSTART;TZID=America/New_York:20261120T090000
      DTEND;TZID=America/New_York:20261120T100000
      SUMMARY:Call`);
    expect(r.events[0]).toMatchObject({ startTime: "15:00", endTime: "16:00" });
    // 2026-03-15: USA schon Sommerzeit, Europa noch nicht: Unterschied 5 Stunden
    const t = run(`UID:b
      DTSTART;TZID=America/New_York:20260315T090000
      DTEND;TZID=America/New_York:20260315T100000
      SUMMARY:Call`, { from: "2026-03-01", to: "2026-03-31" });
    expect(t.events[0]).toMatchObject({ startTime: "14:00" });
  });
  it("Windows-Zonennamen und unbekannte Zonen fallen auf Zürich", () => {
    const r = run(`UID:a
      DTSTART;TZID=W. Europe Standard Time:20261120T080000
      SUMMARY:Outlook`);
    expect(r.events[0].startTime).toBe("08:00");
    const u = run(`UID:b
      DTSTART;TZID=Mars/Olympus:20261120T080000
      SUMMARY:Unbekannt`);
    expect(u.events[0].startTime).toBe("08:00");
  });
  it("schwebende Zeit gilt als Zürcher Zeit", () => {
    expect(run("UID:a\nDTSTART:20261120T080000\nSUMMARY:x").events[0].startTime).toBe("08:00");
  });
  it("ganztägig: Ende exklusiv wird zu letztem Tag, ohne Ende ein Tag", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261123\nDTEND;VALUE=DATE:20261126\nSUMMARY:Lager");
    expect(r.events[0]).toMatchObject({ allDay: true, startDate: "2026-11-23", endDate: "2026-11-25", startTime: null, endTime: null });
    const e = run("UID:b\nDTSTART;VALUE=DATE:20261123\nSUMMARY:Tag");
    expect(e.events[0]).toMatchObject({ startDate: "2026-11-23", endDate: "2026-11-23" });
  });
  it("liest DURATION", () => {
    const r = run("UID:a\nDTSTART:20261120T080000Z\nDURATION:PT1H30M\nSUMMARY:x");
    expect(r.events[0]).toMatchObject({ startTime: "09:00", endTime: "10:30" });
    const d = run("UID:b\nDTSTART;VALUE=DATE:20261120\nDURATION:P2D\nSUMMARY:y");
    expect(d.events[0]).toMatchObject({ startDate: "2026-11-20", endDate: "2026-11-21" });
    const w = run("UID:c\nDTSTART;VALUE=DATE:20261120\nDURATION:P1W\nSUMMARY:z");
    expect(w.events[0].endDate).toBe("2026-11-26");
  });
  it("Termin ohne Ende endet zur Startzeit; Mitternachtsende zählt zum Vortag", () => {
    expect(run("UID:a\nDTSTART:20261120T080000Z\nSUMMARY:x").events[0]).toMatchObject({ startTime: "09:00", endTime: "09:00" });
    const r = run("UID:b\nDTSTART;TZID=Europe/Zurich:20261120T220000\nDTEND;TZID=Europe/Zurich:20261121T000000\nSUMMARY:Nacht");
    expect(r.events[0]).toMatchObject({ endDate: "2026-11-21", endTime: "00:00" });
    // im Fenster nur der 21.: der Termin ist vorbei, bevor der 21. beginnt
    expect(run("UID:c\nDTSTART;TZID=Europe/Zurich:20261120T220000\nDTEND;TZID=Europe/Zurich:20261121T000000\nSUMMARY:Nacht", { from: "2026-11-21", to: "2026-11-30" }).events).toHaveLength(0);
  });
  it("Termin über mehrere Tage erscheint, wenn er ins Fenster hineinreicht", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261029\nDTEND;VALUE=DATE:20261103\nSUMMARY:Ferien");
    expect(r.events).toHaveLength(1);
    expect(run("UID:b\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261025\nSUMMARY:Davor").events).toHaveLength(0);
  });
});

describe("Zeitfenster", () => {
  it("lässt Einzeltermine ausserhalb weg", () => {
    expect(run("UID:a\nDTSTART:20261001T080000Z\nSUMMARY:alt").events).toHaveLength(0);
    expect(run("UID:b\nDTSTART:20270601T080000Z\nSUMMARY:fern").events).toHaveLength(0);
    expect(run("UID:c\nDTSTART:20261101T000000Z\nSUMMARY:rand").events).toHaveLength(1);
  });
  it("rollt Wiederholungen nur im Fenster aus, auch wenn der Start weit zurückliegt", () => {
    const r = run("UID:a\nDTSTART;TZID=Europe/Zurich:20150105T080000\nDTEND;TZID=Europe/Zurich:20150105T090000\nRRULE:FREQ=DAILY\nSUMMARY:täglich", { from: "2026-11-14", to: "2026-11-20" });
    expect(when(r)).toEqual(["2026-11-14 08:00", "2026-11-15 08:00", "2026-11-16 08:00", "2026-11-17 08:00", "2026-11-18 08:00", "2026-11-19 08:00", "2026-11-20 08:00"]);
  });
  it("120 Tage nach vorn und 14 zurück", () => {
    // Heute ist der 14.11.2026: 14 Tage zurück = 31.10., 120 Tage vor = 14.3.2027
    const from = "2026-10-31";
    const to = "2027-03-14";
    const r = run("UID:a\nDTSTART;VALUE=DATE:20260101\nRRULE:FREQ=WEEKLY;BYDAY=SA\nSUMMARY:Sa", { from, to });
    expect(r.events[0].startDate).toBe("2026-10-31");
    expect(r.events.at(-1)!.startDate).toBe("2027-03-13");
  });
});

describe("Wiederholungen", () => {
  it("DAILY mit INTERVAL", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=DAILY;INTERVAL=3;COUNT=4\nSUMMARY:x");
    expect(when(r)).toEqual(["2026-11-01 ganztägig", "2026-11-04 ganztägig", "2026-11-07 ganztägig", "2026-11-10 ganztägig"]);
  });
  it("COUNT zählt ab dem ersten Vorkommen, auch vor dem Fenster", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20260101\nRRULE:FREQ=DAILY;COUNT=310\nSUMMARY:x", { from: "2026-11-01", to: "2026-12-31" });
    // 1. Januar + 309 Tage = 6. November
    expect(r.events.at(-1)!.startDate).toBe("2026-11-06");
  });
  it("UNTIL als Datum, als UTC und lokal; der letzte Tag zählt noch", () => {
    const d = run("UID:a\nDTSTART;TZID=Europe/Zurich:20261102T080000\nRRULE:FREQ=DAILY;UNTIL=20261105\nSUMMARY:x");
    expect(d.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    const z = run("UID:b\nDTSTART;TZID=Europe/Zurich:20261102T080000\nRRULE:FREQ=DAILY;UNTIL=20261104T070000Z\nSUMMARY:x");
    // 08:00 Zürich = 07:00 UTC, also gerade noch drin
    expect(z.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    const z2 = run("UID:b2\nDTSTART;TZID=Europe/Zurich:20261102T080000\nRRULE:FREQ=DAILY;UNTIL=20261104T065900Z\nSUMMARY:x");
    expect(z2.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-03"]);
    const l = run("UID:c\nDTSTART;TZID=Europe/Zurich:20261102T080000\nRRULE:FREQ=DAILY;UNTIL=20261103T080000\nSUMMARY:x");
    expect(l.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-03"]);
    const ad = run("UID:d\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=DAILY;UNTIL=20261103T230000Z\nSUMMARY:x");
    expect(ad.events).toHaveLength(2);
  });
  it("WEEKLY ohne BYDAY nimmt den Wochentag des Starts", () => {
    const r = run("UID:a\nDTSTART:20261104T150000Z\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Mi");
    expect(when(r)).toEqual(["2026-11-04 16:00", "2026-11-11 16:00", "2026-11-18 16:00"]);
  });
  it("WEEKLY mit BYDAY, mehreren Tagen und INTERVAL=2", () => {
    // Start Montag 2. Nov, alle zwei Wochen Mo und Mi
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6\nSUMMARY:x");
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30", "2026-12-02"]);
  });
  it("WEEKLY BYDAY beginnt nicht vor dem Start (Start am Mittwoch, BYDAY=MO,WE,FR)", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261104\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4\nSUMMARY:x");
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11"]);
  });
  it("WEEKLY mit WKST=SU und INTERVAL=2 teilt die Wochen anders", () => {
    // Start Sonntag 8. Nov. Mit WKST=SU beginnt die Woche am Sonntag: So 8. und Mo 9. gehören zusammen.
    const su = run("UID:a\nDTSTART;VALUE=DATE:20261108\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=4\nSUMMARY:x");
    expect(su.events.map((e) => e.startDate)).toEqual(["2026-11-08", "2026-11-09", "2026-11-22", "2026-11-23"]);
    const mo = run("UID:b\nDTSTART;VALUE=DATE:20261108\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4\nSUMMARY:x");
    expect(mo.events.map((e) => e.startDate)).toEqual(["2026-11-08", "2026-11-16", "2026-11-22", "2026-11-30"]);
  });
  it("Zeit bleibt über die Sommerzeit gleich, wenn der Termin eine TZID hat", () => {
    // Winterzeit bis 29.3.2027 (Sommerzeit beginnt)
    const r = run("UID:a\nDTSTART;TZID=Europe/Zurich:20270322T090000\nDTEND;TZID=Europe/Zurich:20270322T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Mo", { from: "2027-03-01", to: "2027-04-30" });
    expect(when(r)).toEqual(["2027-03-22 09:00", "2027-03-29 09:00", "2027-04-05 09:00"]);
    // Herbst: Sommerzeit endet am 25.10.2026
    const h = run("UID:b\nDTSTART;TZID=Europe/Zurich:20261019T090000\nDTEND;TZID=Europe/Zurich:20261019T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Mo", { from: "2026-10-01", to: "2026-11-30" });
    expect(when(h)).toEqual(["2026-10-19 09:00", "2026-10-26 09:00", "2026-11-02 09:00"]);
  });
  it("UTC-Termine verschieben sich in Zürcher Zeit mit der Sommerzeit (RFC: Wandzeit gilt in UTC)", () => {
    const r = run("UID:a\nDTSTART:20270322T080000Z\nDTEND:20270322T090000Z\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:Mo", { from: "2027-03-01", to: "2027-04-30" });
    expect(when(r)).toEqual(["2027-03-22 09:00", "2027-03-29 10:00"]);
  });
  it("Termin am Tag der Zeitumstellung behält Dauer in absoluter Zeit", () => {
    // 29.3.2027: 02:00 -> 03:00. Ein Termin 01:30 bis 03:30 (Zürcher Wandzeit) dauert 1 Stunde.
    const r = run("UID:a\nDTSTART;TZID=Europe/Zurich:20270329T013000\nDTEND;TZID=Europe/Zurich:20270329T033000\nSUMMARY:Nacht", { from: "2027-03-01", to: "2027-04-30" });
    expect(r.events[0]).toMatchObject({ startTime: "01:30", endTime: "03:30" });
  });
  it("MONTHLY: Tag des Starts, BYMONTHDAY und überspringt kurze Monate", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261031\nRRULE:FREQ=MONTHLY;COUNT=4\nSUMMARY:31.", { from: "2026-10-01", to: "2027-06-30" });
    // 31. Okt, (Nov hat 30), 31. Dez, 31. Jan (Feb ohne 31.): vier Vorkommen
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-10-31", "2026-12-31", "2027-01-31", "2027-03-31"]);
    const m = run("UID:b\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=5\nSUMMARY:x");
    expect(m.events.map((e) => e.startDate)).toEqual(["2026-11-01", "2026-11-15", "2026-12-01", "2026-12-15", "2027-01-01"]);
    const neg = run("UID:c\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3\nSUMMARY:Ende");
    expect(neg.events.map((e) => e.startDate)).toEqual(["2026-11-30", "2026-12-31", "2027-01-31"]);
  });
  it("MONTHLY mit Ordnungszahl: zweiter Dienstag, letzter Freitag", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261110\nRRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3\nSUMMARY:x");
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
    const l = run("UID:b\nDTSTART;VALUE=DATE:20261127\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3\nSUMMARY:x");
    expect(l.events.map((e) => e.startDate)).toEqual(["2026-11-27", "2026-12-25", "2027-01-29"]);
    const all = run("UID:c\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=MONTHLY;BYDAY=MO;COUNT=6\nSUMMARY:alle Montage");
    expect(all.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]);
  });
  it("MONTHLY INTERVAL=2", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261115\nRRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=3\nSUMMARY:x");
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-15", "2027-01-15", "2027-03-15"]);
  });
  it("YEARLY: Geburtstag, 29. Februar überspringt Nichtschaltjahre", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20110510\nRRULE:FREQ=YEARLY\nSUMMARY:Geburtstag", { from: "2026-05-01", to: "2028-05-31" });
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-05-10", "2027-05-10", "2028-05-10"]);
    const s = run("UID:b\nDTSTART;VALUE=DATE:20240229\nRRULE:FREQ=YEARLY\nSUMMARY:Schalttag", { from: "2025-01-01", to: "2029-01-01" });
    expect(s.events.map((e) => e.startDate)).toEqual(["2028-02-29"]);
    const m = run("UID:c\nDTSTART;VALUE=DATE:20261105\nRRULE:FREQ=YEARLY;BYMONTH=11,12;BYMONTHDAY=5;COUNT=3\nSUMMARY:x");
    expect(m.events.map((e) => e.startDate)).toEqual(["2026-11-05", "2026-12-05"]);
  });
  it("YEARLY mit INTERVAL=2", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20240601\nRRULE:FREQ=YEARLY;INTERVAL=2\nSUMMARY:x", { from: "2024-01-01", to: "2030-12-31" });
    expect(r.events.map((e) => e.startDate)).toEqual(["2024-06-01", "2026-06-01", "2028-06-01", "2030-06-01"]);
  });
  it("DAILY mit BYDAY (Werktage)", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261113\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=5\nSUMMARY:x");
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
  });
  it("unbekannte Regeln: nur ein Termin, gezählt", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\nSUMMARY:x");
    expect(r.events).toHaveLength(1);
    expect(r.unsupported).toBe(1);
    const h = run("UID:b\nDTSTART:20261101T080000Z\nRRULE:FREQ=HOURLY\nSUMMARY:x");
    expect(h.events).toHaveLength(1);
    expect(h.unsupported).toBe(1);
    expect(run("UID:c\nDTSTART:20261101T080000Z\nRRULE:FREQ=WEEKLY;INTERVAL=0\nSUMMARY:x").unsupported).toBe(1);
  });
  it("Wiederholung endet nie endlos (kaputte Regel, riesiger Abstand)", () => {
    const r = run("UID:a\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30\nSUMMARY:x");
    expect(r.events).toHaveLength(0);
  });
});

describe("Ausnahmen und geänderte Einzeltermine", () => {
  const master = `UID:serie
      DTSTART;TZID=Europe/Zurich:20261102T080000
      DTEND;TZID=Europe/Zurich:20261102T090000
      RRULE:FREQ=WEEKLY;COUNT=4
      SUMMARY:Serie`;
  it("EXDATE mit TZID, UTC und Datum", () => {
    const tz = run(`${master}\nEXDATE;TZID=Europe/Zurich:20261109T080000`);
    expect(tz.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-16", "2026-11-23"]);
    const utc = run(`${master}\nEXDATE:20261116T070000Z`);
    expect(utc.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-09", "2026-11-23"]);
    const d = run(`${master}\nEXDATE;VALUE=DATE:20261123`);
    expect(d.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });
  it("EXDATE mit mehreren Werten und mehreren Zeilen; COUNT zählt Ausnahmen mit", () => {
    const r = run(`${master}\nEXDATE;TZID=Europe/Zurich:20261109T080000,20261116T080000\nEXDATE;TZID=Europe/Zurich:20261102T080000`);
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-23"]);
  });
  it("EXDATE mit falscher Uhrzeit trifft nichts", () => {
    expect(run(`${master}\nEXDATE;TZID=Europe/Zurich:20261109T090000`).events).toHaveLength(4);
  });
  it("RECURRENCE-ID ersetzt ein Vorkommen: andere Zeit, anderer Titel", () => {
    const r = parseIcs(
      cal(
        master,
        `UID:serie
        RECURRENCE-ID;TZID=Europe/Zurich:20261109T080000
        DTSTART;TZID=Europe/Zurich:20261109T140000
        DTEND;TZID=Europe/Zurich:20261109T150000
        SUMMARY:Serie (verschoben)
        LOCATION:Raum 9`,
      ),
      W,
    );
    expect(r.events.map((e) => `${e.startDate} ${e.startTime} ${e.title}`)).toEqual([
      "2026-11-02 08:00 Serie",
      "2026-11-09 14:00 Serie (verschoben)",
      "2026-11-16 08:00 Serie",
      "2026-11-23 08:00 Serie",
    ]);
    expect(r.events[1].location).toBe("Raum 9");
  });
  it("RECURRENCE-ID auf einen anderen Tag verschoben; das Original verschwindet", () => {
    const r = parseIcs(
      cal(
        master,
        `UID:serie
        RECURRENCE-ID;TZID=Europe/Zurich:20261116T080000
        DTSTART;TZID=Europe/Zurich:20261118T080000
        DTEND;TZID=Europe/Zurich:20261118T090000
        SUMMARY:Serie`,
      ),
      W,
    );
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-09", "2026-11-18", "2026-11-23"]);
  });
  it("RECURRENCE-ID in UTC trifft den TZID-Termin", () => {
    const r = parseIcs(
      cal(
        master,
        `UID:serie
        RECURRENCE-ID:20261109T070000Z
        DTSTART:20261109T130000Z
        DTEND:20261109T140000Z
        SUMMARY:UTC-Änderung`,
      ),
      W,
    );
    expect(r.events.find((e) => e.title === "UTC-Änderung")).toMatchObject({ startDate: "2026-11-09", startTime: "14:00" });
    expect(r.events).toHaveLength(4);
  });
  it("abgesagter Einzeltermin (STATUS:CANCELLED) und abgesagte Serie", () => {
    const r = parseIcs(
      cal(
        master,
        `UID:serie
        RECURRENCE-ID;TZID=Europe/Zurich:20261109T080000
        DTSTART;TZID=Europe/Zurich:20261109T080000
        STATUS:CANCELLED
        SUMMARY:Serie`,
      ),
      W,
    );
    expect(r.events.map((e) => e.startDate)).toEqual(["2026-11-02", "2026-11-16", "2026-11-23"]);
    expect(run("UID:x\nDTSTART:20261120T080000Z\nSTATUS:CANCELLED\nSUMMARY:weg").events).toHaveLength(0);
    expect(run(`${master}\nSTATUS:CANCELLED`).events).toHaveLength(0);
  });
  it("geänderter Termin ohne Serie (nur RECURRENCE-ID) erscheint trotzdem", () => {
    const r = run("UID:allein\nRECURRENCE-ID:20261109T070000Z\nDTSTART:20261109T130000Z\nDTEND:20261109T140000Z\nSUMMARY:Gast");
    expect(r.events).toHaveLength(1);
    expect(r.events[0].title).toBe("Gast");
  });
  it("ganztägige Serie mit RECURRENCE-ID und EXDATE als Datum", () => {
    const r = parseIcs(
      cal(
        "UID:g\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=DAILY;COUNT=4\nEXDATE;VALUE=DATE:20261103\nSUMMARY:Tag",
        "UID:g\nRECURRENCE-ID;VALUE=DATE:20261104\nDTSTART;VALUE=DATE:20261110\nSUMMARY:Tag neu",
      ),
      W,
    );
    expect(r.events.map((e) => `${e.startDate} ${e.title}`)).toEqual(["2026-11-02 Tag", "2026-11-05 Tag", "2026-11-10 Tag neu"]);
  });
  it("zwei Termine mit gleicher UID und gleichem Start ergeben einen", () => {
    const e = "UID:dup\nDTSTART:20261120T080000Z\nSUMMARY:x";
    expect(parseIcs(cal(e, e), W).events).toHaveLength(1);
  });
  it("Schlüssel sind je Vorkommen eindeutig", () => {
    const r = run("UID:s\nDTSTART;VALUE=DATE:20261102\nRRULE:FREQ=DAILY;COUNT=5\nSUMMARY:x");
    expect(new Set(r.events.map((e) => e.key)).size).toBe(5);
  });
});

describe("Sortierung und Menge", () => {
  it("sortiert nach Beginn, ganztägig zuerst", () => {
    const r = parseIcs(
      cal("UID:a\nDTSTART:20261120T100000Z\nSUMMARY:B", "UID:b\nDTSTART;VALUE=DATE:20261120\nSUMMARY:A", "UID:c\nDTSTART:20261119T100000Z\nSUMMARY:C"),
      W,
    );
    expect(r.events.map((e) => e.title)).toEqual(["C", "A", "B"]);
  });
  it("verarbeitet einen grossen Kalender zügig", () => {
    const evs = Array.from({ length: 400 }, (_, i) => `UID:e${i}\nDTSTART;TZID=Europe/Zurich:2025010${(i % 9) + 1}T0800${String(i % 60).padStart(2, "0")}\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\nSUMMARY:Serie ${i}`);
    const t = Date.now();
    const r = parseIcs(cal(...evs), { from: "2026-11-01", to: "2027-03-14" });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.events.length).toBeGreaterThan(400 * 20);
  });
});
