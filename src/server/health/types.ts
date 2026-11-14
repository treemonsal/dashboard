// Gemeinsame Typen der Gesundheits-Anbindung. Der Anbieter ist austauschbar (siehe provider.ts).
import type { Bindings } from "../util";

/** Secrets und Einstellungen für die Anbindung; alle optional, damit die App ohne sie läuft. */
export interface HealthEnv extends Bindings {
  /** Secret: OAuth-Client-ID (wrangler secret put GOOGLE_HEALTH_CLIENT_ID). */
  GOOGLE_HEALTH_CLIENT_ID?: string;
  /** Secret: OAuth-Client-Secret (wrangler secret put GOOGLE_HEALTH_CLIENT_SECRET). */
  GOOGLE_HEALTH_CLIENT_SECRET?: string;
  /** Secret: mindestens 32 Zeichen Zufall, daraus entsteht der AES-Schlüssel für die Tokens (wrangler secret put HEALTH_TOKEN_KEY). */
  HEALTH_TOKEN_KEY?: string;
  /** Nur Tests: andere Basisadressen für die Schnittstelle. Nie in Produktion setzen. */
  HEALTH_API_BASE?: string;
  HEALTH_OAUTH_BASE?: string;
}

export interface TokenSet {
  accessToken: string;
  /** Nur beim ersten Austausch oder wenn der Anbieter einen neuen ausgibt. */
  refreshToken?: string;
  /** ISO-Zeitpunkt, ab dem der Zugriffstoken nicht mehr gilt. */
  expiresAt: string;
  scope: string;
}

/** Ein Tageswert; fehlende Werte sind null und überschreiben nichts. */
export interface DayValues {
  day: string;
  sleepMin: number | null;
  steps: number | null;
  restingHr: number | null;
  weightKg: number | null;
}

export interface Workout {
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

export interface FetchResult {
  days: DayValues[];
  workouts: Workout[];
  /** Je Messgrösse, die nicht gelesen werden konnte, eine kurze Meldung (ohne Adresse und Token). */
  problems: string[];
}

/** Fehler mit Meldung, die der Besitzer lesen darf. */
export class HealthError extends Error {
  constructor(
    message: string,
    public kind: "auth" | "config" | "api" = "api",
  ) {
    super(message);
  }
}

export interface HealthProvider {
  id: string;
  label: string;
  configured(env: HealthEnv): boolean;
  authUrl(env: HealthEnv, p: { redirectUri: string; state: string; challenge: string }): string;
  exchange(env: HealthEnv, p: { code: string; verifier: string; redirectUri: string }, f: typeof fetch): Promise<TokenSet>;
  refresh(env: HealthEnv, refreshToken: string, f: typeof fetch): Promise<TokenSet>;
  revoke(env: HealthEnv, token: string, f: typeof fetch): Promise<void>;
  /** Liest [from, toExclusive) als Zürcher Kalendertage. */
  fetchRange(env: HealthEnv, accessToken: string, from: string, toExclusive: string, f: typeof fetch): Promise<FetchResult>;
}
