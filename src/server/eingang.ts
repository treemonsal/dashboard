// Eingang per Kurzbefehl: POST /eingang/buchung.
//
// Diese Route steht AUSSERHALB der Cloudflare-Access-Anmeldung und muss davon ausgehen, dass die Adresse jedem bekannt ist.
// Sie schützt sich allein mit einem eigenen Schlüssel (Authorization: Bearer ...), der nur als SHA-256-Hash gespeichert wird.
// Sie kann ausschliesslich vorläufige Buchungen anlegen. Sie liest und ändert nichts und antwortet nie mit Daten.
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "./db/schema";
import { cleanMerchant, dedupeKey, parseBetrag } from "../shared/bank";
import { SETTING_DEFAULTS } from "../shared/settings";
import { todayInZone } from "../shared/dates";
import { accountByName, createProvisional, classify } from "./vorlaeufig";
import { batch, newId, type Bindings, type Db } from "./util";

const t = schema;

export const INTAKE_PATH = "/eingang/buchung";
export const MAX_RAPPEN = 500_000; // 5000 Franken
export const LIMIT_PER_MINUTE = 10;
export const LIMIT_PER_DAY = 60;
export const MAX_FAILS_PER_HOUR = 20;
export const DEDUPE_WINDOW_MS = 120_000;
const MAX_BODY = 4096;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
/** Händler höchstens 120 Zeichen (roh gemessen), Betrag als Zahl oder Text, Währung, Karte, Zeitpunkt. Unbekannte Felder sind ein Fehler. */
export const intakeBody = z
  .object({
    merchant: z.string().max(120),
    amount: z.union([z.number(), z.string().max(40)]),
    currency: z.preprocess(empty, z.string().regex(/^[A-Za-z]{3}$/).optional()),
    card: z.preprocess(empty, z.string().max(80).optional()),
    at: z.preprocess(empty, z.string().max(40).optional()),
  })
  .strict();

export type IntakeInput = { merchant: string; rappen: number; currency: string; card?: string; date: string };

/** Prüft den Inhalt und macht daraus eine Buchung (Rappen positiv, Datum in Zürich). Gibt nur einen Grundcode zurück, keine Eingabewerte. */
export function readIntake(body: unknown, now: Date): { ok: true; value: IntakeInput } | { ok: false; reason: string } {
  const p = intakeBody.safeParse(body);
  if (!p.success) return { ok: false, reason: "form" };
  const merchant = cleanMerchant(p.data.merchant);
  if (!merchant) return { ok: false, reason: "haendler" };
  const amount = parseBetrag(p.data.amount);
  if (!amount) return { ok: false, reason: "betrag" };
  if (amount.rappen <= 0 || amount.rappen > MAX_RAPPEN) return { ok: false, reason: "betrag" };
  const field = p.data.currency?.toUpperCase();
  if (field && amount.currency && field !== amount.currency) return { ok: false, reason: "waehrung" };
  const currency = amount.currency ?? field ?? "CHF";
  let date = todayInZone(now);
  if (p.data.at) {
    const ms = Date.parse(p.data.at);
    if (!Number.isFinite(ms) || ms < now.getTime() - 14 * 86400_000 || ms > now.getTime() + 86400_000) return { ok: false, reason: "zeit" };
    date = todayInZone(new Date(ms));
  }
  return { ok: true, value: { merchant, rappen: amount.rappen, currency, card: p.data.card ? cleanMerchant(p.data.card) : undefined, date } };
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Zeitkonstanter Vergleich zweier gleich langer Hex-Texte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const respond = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...extra },
  });

async function readLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max || !req.body) return declared > max ? null : "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const iso = (ms: number) => new Date(ms).toISOString();

async function countLog(db: Db, kinds: ("fail" | "auth" | "ok" | "dup" | "test")[], sinceMs: number): Promise<number> {
  const r = await db.select({ n: count() }).from(t.intakeLog).where(and(inArray(t.intakeLog.kind, kinds), gte(t.intakeLog.at, iso(sinceMs)))).get();
  return r?.n ?? 0;
}

const logKind = (db: Db, kind: "fail" | "auth" | "ok" | "dup" | "test", nowMs: number) => db.insert(t.intakeLog).values({ id: newId(), kind, at: iso(nowMs) });
// sync_runs bekommt nie Händler oder Betrag, nur einen festen Text.
const logRun = (db: Db, ok: boolean, message: string) => db.insert(t.syncRuns).values({ id: newId(), kind: "kurzbefehl", ok, message });

/** Konto für diese Anfrage: gewählter Name aus den Einstellungen, ausser die Karte nennt ein anderes vorhandenes Konto. */
export async function intakeAccount(db: Db, card?: string) {
  const row = await db.select().from(t.settings).where(eq(t.settings.key, "eingangKonto")).get();
  return accountByName(db, row?.value || SETTING_DEFAULTS.eingangKonto, card);
}

export async function handleIntake(req: Request, env: Pick<Bindings, "DB">, nowMs: number = Date.now()): Promise<Response> {
  const db = drizzle(env.DB, { schema });
  const notFound = () => respond(404, { error: "Nicht gefunden" });
  // Nur POST auf genau diesen Pfad; ohne Schlüssel in der Datenbank gibt es die Route nicht.
  if (req.method !== "POST") return notFound();
  const key = await db.select().from(t.intakeKeys).orderBy(desc(t.intakeKeys.createdAt)).limit(1).get();
  if (!key) return notFound();

  // Gesperrt nach zu vielen Fehlversuchen: gilt für alle gleich, schreibt nichts mehr.
  if ((await countLog(db, ["fail"], nowMs - 3600_000)) >= MAX_FAILS_PER_HOUR) return respond(429, { error: "gesperrt" }, { "retry-after": "3600" });

  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
  const token = m?.[1] ?? "";
  const given = await sha256Hex(KEY_RE.test(token) ? token : "ungueltig");
  if (!KEY_RE.test(token) || !safeEqual(given, key.hash)) {
    await batch(db, [logKind(db, "fail", nowMs), logRun(db, false, "Schlüssel falsch")]);
    return respond(401, { error: "unauthorized" });
  }

  if ((await countLog(db, ["auth"], nowMs - 60_000)) >= LIMIT_PER_MINUTE || (await countLog(db, ["auth"], nowMs - 86400_000)) >= LIMIT_PER_DAY) {
    return respond(429, { error: "zu viele Anfragen" }, { "retry-after": "60" });
  }
  await batch(db, [logKind(db, "auth", nowMs), db.delete(t.intakeLog).where(lt(t.intakeLog.at, iso(nowMs - 7 * 86400_000)))]);

  const text = await readLimited(req, MAX_BODY);
  if (text === null) {
    await logRun(db, false, "Eingabe zu gross");
    return respond(413, { error: "zu gross" });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await logRun(db, false, "Eingabe ungültig");
    return respond(400, { error: "ungültig" });
  }
  const read = readIntake(body, new Date(nowMs));
  if (!read.ok) {
    await logRun(db, false, `Eingabe ungültig (${read.reason})`);
    return respond(400, { error: "ungültig", grund: read.reason });
  }
  const v = read.value;
  const acc = await intakeAccount(db, v.card);
  if (!acc) {
    await logRun(db, false, "Konto nicht gefunden");
    return respond(422, { error: "konto" });
  }

  // Doppel-Schutz: gleicher Händler, Betrag, Währung und Konto innerhalb von 2 Minuten zählt einmal.
  const same = await db
    .select({ id: t.transactions.id })
    .from(t.transactions)
    .where(and(eq(t.transactions.origin, "kurzbefehl"), eq(t.transactions.accountId, acc.id), eq(t.transactions.amount, -v.rappen / 100), eq(t.transactions.currency, v.currency), sql`lower(${t.transactions.description}) = ${v.merchant.toLowerCase()}`, gte(t.transactions.createdAt, iso(nowMs - DEDUPE_WINDOW_MS))))
    .limit(1)
    .get();
  const bucket = Math.floor(nowMs / DEDUPE_WINDOW_MS);
  const dedupe = await sha256Hex(`${dedupeKey({ merchant: v.merchant, rappen: -v.rappen, currency: v.currency, account: acc.id })}|${bucket}`);
  let duplicate = !!same;
  if (!duplicate) {
    try {
      await createProvisional(db, { accountId: acc.id, description: v.merchant, rappen: -v.rappen, currency: v.currency, date: v.date, origin: "kurzbefehl", dedupe, createdAt: iso(nowMs) });
    } catch (e) {
      // Zwei gleichzeitige Anfragen: die zweite scheitert am eindeutigen Doppel-Schlüssel und zählt als Doppel.
      if (!/UNIQUE/i.test(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`)) {
        console.error("eingang", (e as Error).message);
        await logRun(db, false, "Serverfehler");
        return respond(500, { error: "Serverfehler" });
      }
      duplicate = true;
    }
  }
  await batch(db, [logKind(db, duplicate ? "dup" : "ok", nowMs), logRun(db, true, duplicate ? "Doppel ignoriert" : "Buchung gespeichert")]);
  return respond(200, { ok: true });
}

/** Test aus der App (angemeldete Route): dieselbe Prüfung bis zur Zuordnung, aber es wird keine Buchung angelegt. */
export async function intakeTest(db: Db, nowMs: number = Date.now()) {
  const acc = await intakeAccount(db);
  if (!acc) {
    await logRun(db, false, "Test: Konto nicht gefunden");
    return { ok: false as const, reason: "konto" as const };
  }
  const read = readIntake({ merchant: "Test", amount: "CHF 1.00" }, new Date(nowMs));
  if (!read.ok) return { ok: false as const, reason: read.reason };
  const c = await classify(db, { description: read.value.merchant, rappen: -read.value.rappen, currency: read.value.currency, date: read.value.date });
  await batch(db, [logKind(db, "test", nowMs), logRun(db, true, "Test aus der App")]);
  return { ok: true as const, account: acc.name, category: c.categoryName };
}

export async function intakeStatus(db: Db) {
  const key = await db.select({ createdAt: t.intakeKeys.createdAt }).from(t.intakeKeys).orderBy(desc(t.intakeKeys.createdAt)).limit(1).get();
  const last = await db.select({ at: t.intakeLog.at }).from(t.intakeLog).where(inArray(t.intakeLog.kind, ["ok", "dup"])).orderBy(desc(t.intakeLog.at)).limit(1).get();
  const fails = await countLog(db, ["fail"], Date.now() - 3600_000);
  return { active: !!key, createdAt: key?.createdAt ?? null, lastAt: last?.at ?? null, locked: fails >= MAX_FAILS_PER_HOUR };
}

/** Neuen Schlüssel erzeugen; der alte wird dabei ungültig. Der Klartext verlässt diese Funktion genau einmal. */
export async function createIntakeKey(db: Db): Promise<string> {
  const key = newKey();
  const hash = await sha256Hex(key);
  await batch(db, [db.delete(t.intakeKeys), db.insert(t.intakeKeys).values({ id: newId(), hash })]);
  return key;
}

export const revokeIntakeKey = (db: Db) => db.delete(t.intakeKeys);
