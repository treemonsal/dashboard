// Trainings aus Fitbit: Liste im Körper-Tab, Unterseite nach Wochen, Blatt je Training, Hinweis im Trainingsblatt.
import { useQuery } from "@tanstack/react-query";
import { addDays, dayCompact, mondayOf, todayInZone } from "../shared/dates";
import { Icon, Segments, nf } from "./ui";
import { Link } from "./router";
import { call } from "./fitbit-setup";
import { useFinishSession, useGymDay, useSetSetting, useSettings } from "./queries";

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
  CARDIO_WORKOUT: "Aktivität", TABLE_TENNIS: "Tischtennis", BASKETBALL: "Basketball", VOLLEYBALL: "Volleyball", SOCCER: "Fussball", TRAMPOLINE: "Trampolin",
};
/** Symbol je Trainingsart; alles Unbekannte ist die Pulslinie. */
const ICONS: Record<string, string> = {
  STRENGTH_TRAINING: "dumbbell", WEIGHTLIFTING: "dumbbell", WALK: "walk", WALKING: "walk", HIKE: "walk", HIKING: "walk", RUN: "run", RUNNING: "run",
  BIKE: "bike", BIKING: "bike", CYCLING: "bike", SWIM: "swim", SWIMMING: "swim", TABLE_TENNIS: "racket", BASKETBALL: "ball", VOLLEYBALL: "ball", SOCCER: "ball",
  TRAMPOLINE: "jump",
};
export const workoutIcon = (w: { type: string }) => ICONS[w.type.toUpperCase()] ?? "pulse";
export const isStrength = (w: { type: string }) => /STRENGTH|WEIGHT/i.test(w.type);
export const isWalk = (w: { type: string }) => /^WALK/i.test(w.type);
export function workoutTitle(w: WorkoutRow): string {
  const t = TYPES[w.type.toUpperCase()];
  if (t) return t;
  const raw = ((w.name && w.name.trim()) || w.type.replace(/_/g, " ").toLowerCase()).replace(/ß/g, "ss");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
const clock = (iso: string) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
/** "27 Min", ab einer Stunde "1 h 35 Min". */
export const fmtMin = (m: number) => (m < 60 ? `${m} Min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} Min`);

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
      <Row k="Dauer" v={w.minutes !== null ? fmtMin(w.minutes) : null} />
      <Row k="Kalorien" v={w.kcal !== null ? `${nf(w.kcal)} kcal` : null} />
      <Row k="Puls" v={w.avgHr !== null ? `${w.avgHr} bpm` : null} />
      <Row k="Quelle" v="Fitbit" />
    </div>
  );
}

/** Ansicht "Sport" (ohne Gehen, Standard) oder "Alle". Die Wahl liegt in den Einstellungen. */
function useView() {
  const set = useSetSetting();
  const view = useSettings().workoutView === "alle" ? "alle" : "sport";
  return { view, set: (v: "sport" | "alle") => set({ workoutView: v }) } as const;
}
function ViewPill() {
  const { view, set } = useView();
  return <Segments full={false} label="Ansicht" value={view} onChange={set} options={[{ v: "sport", label: "Sport" }, { v: "alle", label: "Alle" }]} />;
}
function Row({ w }: { w: WorkoutRow }) {
  return (
    <Link href={`/koerper/trainings/woche/${mondayOf(w.day)}/${encodeURIComponent(w.id)}`} className="lrow press">
      <span className="ic"><Icon n={workoutIcon(w)} /></span>
      <span className="w">
        <b>{workoutTitle(w)}</b>
        <span>{dayCompact(w.day)} · {clock(w.startAt)}</span>
      </span>
      <span className="a muted" style={{ fontSize: 14 }}>{w.minutes !== null ? fmtMin(w.minutes) : ""}<Icon n="chev" className="go" /></span>
    </Link>
  );
}
function useList() {
  const { view } = useView();
  const today = todayInZone();
  const q = useWorkouts(addDays(today, -365), today);
  const all = [...(q.data ?? [])].sort((a, b) => b.startAt.localeCompare(a.startAt));
  return { all, list: view === "sport" ? all.filter((w) => !isWalk(w)) : all };
}

/** Letzte 5 Trainings aus Fitbit im Körper-Tab. Ohne jedes Training: nichts. */
export function Trainings() {
  const { all, list } = useList();
  if (all.length === 0) return null;
  return (
    <div className="card">
      <h2>Trainings</h2>
      <div className="viewpill"><ViewPill /></div>
      {list.length === 0 && <div className="empty">Kein Sport erkannt.</div>}
      {list.slice(0, 5).map((w) => <Row key={w.id} w={w} />)}
      {list.length > 5 && (
        <div className="empty" style={{ padding: "4px 0 8px" }}>
          <Link href="/koerper/trainings" className="link">Alle anzeigen</Link>
        </div>
      )}
    </div>
  );
}

/** Hinweis im Trainingsblatt: Fitbit hat an diesem Tag Krafttraining erkannt. Zählt erst, wenn du den Tag einträgst. */
export function FitbitHinweis({ day }: { day: string }) {
  const q = useWorkouts(day, day);
  const gym = useGymDay(day);
  const fin = useFinishSession(day);
  const w = (q.data ?? []).filter(isStrength);
  if (w.length === 0) return null;
  const min = w.reduce((a, x) => a + (x.minutes ?? 0), 0);
  const s = gym.data?.session;
  const offer = !!gym.data?.plan && !s?.finishedAt && !(s?.sets ?? []).some((x) => x.done);
  return (
    <>
      <div className="fs-hint">Fitbit hat Krafttraining erkannt{min ? ` · ${fmtMin(min)}` : ""}</div>
      {offer && (
        <button type="button" className="chip btn press fs-gym" onClick={() => fin.mutate(true)}>Als Gym-Tag eintragen</button>
      )}
    </>
  );
}
