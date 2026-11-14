// Geführte Einrichtung von Fitbit (Blatt mit 7 Schritten) und Trainings aus Fitbit (Liste, Blatt, Hinweis im Trainingsblatt).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, dayCompact, todayInZone } from "../shared/dates";
import { ConfirmDelete, Icon, nf } from "./ui";
import { notify } from "./toast";
import { useSheet } from "./sheet";

export interface Status {
  configured: boolean;
  missing: string[];
  connected: boolean;
  connectedAt: string | null;
  needsReconnect: boolean;
  lastError: string | null;
  lastRun: { at: string; ok: boolean; message: string | null } | null;
  redirectUri: string;
  credentials: { present: boolean; source: "app" | "secret" | null; idTail: string | null };
  setup: number[];
  scopes: string[];
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/fitbit${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  // 409 (nicht verbunden) ist eine Antwort mit Inhalt, kein Absturz.
  if (!res.ok && res.status !== 409) throw new Error(j.error ?? `Fehler ${res.status}`);
  return j;
}

export const statusKey = ["fitbit-status"] as const;
export const useStatus = () => useQuery({ queryKey: statusKey, queryFn: () => call<Status>("GET", "/status"), refetchInterval: (q) => (q.state.data?.connected && !q.state.data.lastRun ? 3000 : false) });

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Kopiert");
  } catch {
    notify("Nicht kopiert");
  }
}

const L = {
  projekt: "https://console.cloud.google.com/projectcreate",
  api: "https://console.developers.google.com/apis/library/health.googleapis.com",
  zielgruppe: "https://console.developers.google.com/auth/audience",
  bereiche: "https://console.developers.google.com/auth/scopes",
  client: "https://console.developers.google.com/apis/credentials",
};
const STEPS = 7;

function Open({ href }: { href: string }) {
  return (
    <a className="chip btn press" href={href} target="_blank" rel="noopener noreferrer">
      Öffnen
    </a>
  );
}
function Copy({ text, label = "Kopieren" }: { text: string; label?: string }) {
  return (
    <button type="button" className="chip btn press" onClick={() => copy(text)}>
      {label}
    </button>
  );
}

// Ausserhalb der Blatt-Funktion, sonst würde jede Eingabe die Felder neu erzeugen (Fokus weg).
function StepRow({ n, text, done, onToggle, children }: { n: number; text: string; done: boolean; onToggle: (n: number) => void; children?: React.ReactNode }) {
  return (
    <li className="fs">
      <button type="button" className="fs-n press" aria-pressed={done} aria-label={`Schritt ${n} ${done ? "erledigt" : "offen"}`} onClick={() => n < 6 && onToggle(n)} disabled={n >= 6}>
        {done ? <Icon n="check" /> : n}
      </button>
      <div className="fs-b">
        <p>{text}</p>
        {children && <div className="fs-a">{children}</div>}
      </div>
    </li>
  );
}

export function FitbitSetupSheet({ connect }: { connect: { busy: boolean; start: () => void } }) {
  const qc = useQueryClient();
  const st = useStatus();
  const s = st.data;
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  if (!s) return <div style={{ minHeight: 200 }} />;

  const credOk = s.credentials.present;
  const done = new Set(s.setup);
  if (credOk) done.add(6);
  if (s.connected) done.add(7);
  const refresh = () => qc.invalidateQueries({ queryKey: statusKey });

  async function toggle(n: number) {
    const next = new Set(s!.setup);
    next.has(n) ? next.delete(n) : next.add(n);
    qc.setQueryData<Status>(statusKey, (d) => (d ? { ...d, setup: [...next] } : d));
    try {
      await call("PUT", "/setup", { done: [...next] });
    } catch {
      notify("Nicht gespeichert");
    }
    void refresh();
  }
  async function save() {
    setSaving(true);
    setErr("");
    try {
      await call("PUT", "/credentials", { clientId: id.trim(), clientSecret: secret.trim() });
      setId("");
      setSecret("");
      notify("Gespeichert");
    } catch {
      setErr("Nicht gespeichert. Beide Werte ohne Leerzeichen einfügen.");
    } finally {
      setSaving(false);
      void refresh();
    }
  }
  async function remove() {
    try {
      await call("DELETE", "/credentials");
    } catch {
      notify("Nicht gelöscht");
    }
    void refresh();
  }

  return (
    <div>
      <h3>Fitbit einrichten</h3>
      <div className="when">{done.size} von {STEPS} erledigt</div>
      <ol className="fs-l">
        <StepRow n={1} done={done.has(1)} onToggle={toggle} text="Lege in Google Cloud ein Projekt mit dem Namen «Dashboard» an.">
          <Open href={L.projekt} />
          <Copy text="Dashboard" label="Namen kopieren" />
        </StepRow>
        <StepRow n={2} done={done.has(2)} onToggle={toggle} text="Schalte die «Google Health API» ein («Aktivieren», Enable).">
          <Open href={L.api} />
        </StepRow>
        <StepRow n={3} done={done.has(3)} onToggle={toggle} text="Wähle Zielgruppe «Extern» (External), trage deine E-Mail als «Testnutzer» (Test users) ein und tippe «App veröffentlichen» (Publish app).">
          <Open href={L.zielgruppe} />
          <Copy text="Dashboard" label="App-Namen kopieren" />
        </StepRow>
        <StepRow n={4} done={done.has(4)} onToggle={toggle} text="Tippe «Bereiche hinzufügen oder entfernen» (Add or remove scopes), füge die drei Bereiche ein, dann «Aktualisieren» (Update) und «Speichern» (Save).">
          <Open href={L.bereiche} />
          <Copy text={s.scopes.join("\n")} label="Alle drei kopieren" />
        </StepRow>
        <StepRow n={5} done={done.has(5)} onToggle={toggle} text="Erstelle unter «Anmeldedaten» einen «OAuth-Client-ID» (OAuth client ID) vom Typ «Webanwendung» (Web application) mit dieser Weiterleitungs-URI.">
          <Open href={L.client} />
          <Copy text={s.redirectUri} label="Adresse kopieren" />
        </StepRow>
        <StepRow n={6} done={done.has(6)} onToggle={toggle} text="Füge Client-ID und Client-Secret hier ein und speichere.">
          {credOk && (
            <div className="fs-ok">
              Eingetragen{s.credentials.idTail ? `, ID endet auf ${s.credentials.idTail}` : ""}
              {s.credentials.source === "secret" ? " (vom Server)" : ""}
            </div>
          )}
          {(!credOk || s.credentials.source === "secret") && (
            <div className="fs-f">
              <input className="inp grow" placeholder="Client-ID" aria-label="Client-ID" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} />
              <input className="inp grow" type="password" placeholder="Client-Secret" aria-label="Client-Secret" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} />
              {err && <div className="warn" role="alert" style={{ fontSize: 14 }}>{err}</div>}
              <button type="button" className="chip btn press" disabled={saving || id.trim().length < 8 || secret.trim().length < 8} onClick={save}>
                {saving ? "Speichert" : "Speichern"}
              </button>
            </div>
          )}
          {s.credentials.source === "app" && <ConfirmDelete label="Zugangsdaten löschen" sure="Wirklich löschen" onConfirm={remove} />}
        </StepRow>
        <StepRow n={7} done={done.has(7)} onToggle={toggle} text="Verbinde Fitbit mit Google.">
          {s.connected ? (
            <div className="fs-ok">Verbunden</div>
          ) : (
            <button type="button" className="chip btn press" disabled={!s.configured || connect.busy} onClick={connect.start}>
              {connect.busy ? "Öffnet" : "Fitbit verbinden"}
            </button>
          )}
        </StepRow>
      </ol>
      <p className="fs-note">Falls Google wegen deines Alters kein Projekt zulässt: Ein Elternteil macht die Schritte 1 bis 5 im eigenen Google-Konto und trägt deine E-Mail als Testnutzer ein.</p>
    </div>
  );
}

/* ---------- Trainings ---------- */
export interface WorkoutRow {
  id: string;
  day: string;
  startAt: string;
  endAt: string | null;
  type: string;
  name: string | null;
  minutes: number | null;
  kcal: number | null;
  avgHr: number | null;
}

const TYPES: Record<string, string> = {
  STRENGTH_TRAINING: "Krafttraining", WEIGHTLIFTING: "Krafttraining", RUN: "Laufen", RUNNING: "Laufen", WALK: "Gehen", WALKING: "Gehen",
  BIKE: "Velo", BIKING: "Velo", CYCLING: "Velo", SWIM: "Schwimmen", SWIMMING: "Schwimmen", HIKE: "Wandern", HIKING: "Wandern",
  WORKOUT: "Training", HIIT: "HIIT", YOGA: "Yoga", SPORT: "Sport", ELLIPTICAL: "Crosstrainer", TREADMILL: "Laufband",
};
export const isStrength = (w: { type: string }) => /STRENGTH|WEIGHT/i.test(w.type);
export function workoutTitle(w: WorkoutRow): string {
  const t = TYPES[w.type.toUpperCase()];
  if (t) return t;
  const raw = (w.name && w.name.trim()) || w.type.replace(/_/g, " ").toLowerCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
const clock = (iso: string) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export const useWorkouts = (from: string, to: string) =>
  useQuery({ queryKey: ["health-workouts", from, to], queryFn: () => call<WorkoutRow[]>("GET", `/workouts?from=${from}&to=${to}`) });

export function WorkoutSheet({ w }: { w: WorkoutRow }) {
  const Row = ({ k, v }: { k: string; v: string | null }) =>
    v === null ? null : (
      <div className="field">
        <span>{k}</span>
        <span className="rt">{v}</span>
      </div>
    );
  return (
    <div>
      <h3>{workoutTitle(w)}</h3>
      <div className="when">{dayCompact(w.day)} · {clock(w.startAt)}{w.endAt ? ` bis ${clock(w.endAt)}` : ""}</div>
      <Row k="Dauer" v={w.minutes !== null ? `${w.minutes} Min` : null} />
      <Row k="Kalorien" v={w.kcal !== null ? `${nf(w.kcal)} kcal` : null} />
      <Row k="Puls" v={w.avgHr !== null ? `${w.avgHr} bpm` : null} />
      <Row k="Quelle" v="Fitbit" />
    </div>
  );
}

/** Letzte Trainings aus Fitbit im Körper-Tab. Ohne Trainings: nichts. */
export function Trainings() {
  const sheet = useSheet();
  const today = todayInZone();
  const q = useWorkouts(addDays(today, -60), today);
  const list = [...(q.data ?? [])].reverse().slice(0, 5);
  if (list.length === 0) return null;
  return (
    <div className="card">
      <h2>Trainings</h2>
      {list.map((w) => (
        <button key={w.id} type="button" className="lrow press" onClick={() => sheet.open(<WorkoutSheet w={w} />)}>
          <span className="ic"><Icon n="dumbbell" /></span>
          <span className="w">
            <b>{workoutTitle(w)}</b>
            <span>{dayCompact(w.day)}</span>
          </span>
          <span className="a muted" style={{ fontSize: 14 }}>{w.minutes !== null ? `${w.minutes} Min` : ""}</span>
        </button>
      ))}
    </div>
  );
}

/** Hinweis im Trainingsblatt: Fitbit hat an diesem Tag Krafttraining erkannt. Zählt nicht als Gym. */
export function FitbitHinweis({ day }: { day: string }) {
  const q = useWorkouts(day, day);
  const w = (q.data ?? []).filter(isStrength);
  if (w.length === 0) return null;
  const min = w.reduce((a, x) => a + (x.minutes ?? 0), 0);
  return <div className="fs-hint">Fitbit hat Krafttraining erkannt{min ? ` · ${min} Min` : ""}</div>;
}
