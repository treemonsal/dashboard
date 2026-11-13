// Schnelleingabe: erkennt "heute", "morgen", Wochentage, "18 Uhr", "30 min" im Text und lässt den Rest als Titel stehen.
import { addDays, weekdayNum } from "./dates";

export interface QuickParse {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  durationMin: number | null;
}

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (src: string) => new RegExp(L + src + R, "iu");

const DAYS: Record<string, number> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
};
const SHORT: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 };

function take(text: string, rx: RegExp): { rest: string; m: RegExpExecArray } | null {
  const m = rx.exec(text);
  if (!m) return null;
  return { rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " "), m };
}

const pad = (n: number) => String(n).padStart(2, "0");
const validTime = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;

export function parseQuick(input: string, today: string): QuickParse {
  let text = ` ${input.trim()} `;
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let durationMin: number | null = null;

  // Dauer: "30 min", "1 h", "1.5 h", "90 minuten"
  let t = take(text, re("(\\d+(?:[.,]\\d+)?)\\s*(?:h|std|stunden?)"));
  if (t) {
    durationMin = Math.round(parseFloat(t.m[1].replace(",", ".")) * 60);
    text = t.rest;
  } else if ((t = take(text, re("(\\d+)\\s*(?:min|mins|minuten?)")))) {
    durationMin = parseInt(t.m[1], 10);
    text = t.rest;
  }
  if (durationMin !== null && (durationMin < 1 || durationMin > 1440)) durationMin = null;

  // Datum "27.11." oder "27.11.2026" (vor der Uhrzeit, damit "27.11." nicht als Zeit gilt)
  const d1 = take(text, re("(?:am\\s+)?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})?"));
  if (d1) {
    const day = +d1.m[1], mon = +d1.m[2];
    const ok = (yy: number) => {
      const dt = new Date(Date.UTC(yy, mon - 1, day));
      return dt.getUTCMonth() === mon - 1 && dt.getUTCDate() === day;
    };
    const iso = (yy: number) => `${yy}-${pad(mon)}-${pad(day)}`;
    let y = d1.m[3] ? +d1.m[3] : +today.slice(0, 4);
    if (ok(y)) {
      if (!d1.m[3] && iso(y) < today) y += 1;
      if (ok(y)) {
        dueDate = iso(y);
        text = d1.rest;
      }
    }
  }

  // Uhrzeit: "18 Uhr", "18:30", "18.30 Uhr", "um 18"
  const timeRes: [RegExp, (m: RegExpExecArray) => [number, number]][] = [
    [re("(?:um\\s+|ab\\s+)?(\\d{1,2}):(\\d{2})\\s*(?:uhr)?"), (m) => [+m[1], +m[2]]],
    [re("(?:um\\s+|ab\\s+)?(\\d{1,2})\\.(\\d{2})\\s*uhr"), (m) => [+m[1], +m[2]]],
    [re("(?:um\\s+|ab\\s+)?(\\d{1,2})\\s*uhr"), (m) => [+m[1], 0]],
    [re("um\\s+(\\d{1,2})"), (m) => [+m[1], 0]],
  ];
  for (const [rx, f] of timeRes) {
    const x = take(text, rx);
    if (!x) continue;
    const [h, mi] = f(x.m);
    if (!validTime(h, mi)) continue;
    dueTime = `${pad(h)}:${pad(mi)}`;
    text = x.rest;
    break;
  }

  if (!dueDate) {
    let x: ReturnType<typeof take>;
    if ((x = take(text, re("übermorgen")))) { dueDate = addDays(today, 2); text = x.rest; }
    else if ((x = take(text, re("morgen")))) { dueDate = addDays(today, 1); text = x.rest; }
    else if ((x = take(text, re("heute")))) { dueDate = today; text = x.rest; }
    else if ((x = take(text, re("in\\s+(\\d{1,3})\\s+tagen?")))) { dueDate = addDays(today, +x.m[1]); text = x.rest; }
    else if ((x = take(text, re("(?:(?:am|nächsten|nächste|kommenden)\\s+)?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)")))) {
      dueDate = nextWeekday(today, DAYS[x.m[1].toLowerCase()]);
      text = x.rest;
    } else if ((x = take(text, re("am\\s+(so|mo|di|mi|do|fr|sa)")))) {
      dueDate = nextWeekday(today, SHORT[x.m[1].toLowerCase()]);
      text = x.rest;
    }
  }

  let title = text.replace(/\s+/g, " ").trim();
  title = title.replace(/^(?:um|am|ab|bis|für)\s+/iu, "").replace(/\s+(?:um|am|ab|bis|für|,)$/iu, "").replace(/[\s,;:-]+$/u, "").trim();
  if (!title) title = input.trim();
  return { title, dueDate, dueTime, durationMin };
}

/** Nächster Tag mit diesem Wochentag, mindestens morgen. */
function nextWeekday(today: string, wd: number): string {
  const diff = ((wd - weekdayNum(today) + 7) % 7) || 7;
  return addDays(today, diff);
}
