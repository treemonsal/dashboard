// Geführte Einrichtung von Fitbit (Blatt mit 7 Schritten). Trainings stehen in trainings.tsx.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDelete, Icon } from "./ui";
import { notify } from "./toast";

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
