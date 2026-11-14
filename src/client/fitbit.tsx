// Fitbit (Google Health): verbinden, Status, abgleichen, trennen. Eingehängt in Einstellungen und im Leerzustand des Körper-Tabs.
// Eigene kleine API-Hülle, damit api.ts und queries.ts unberührt bleiben.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDelete } from "./ui";
import { notify } from "./toast";
import { Link } from "./router";

interface Status {
  configured: boolean;
  missing: string[];
  connected: boolean;
  connectedAt: string | null;
  needsReconnect: boolean;
  lastError: string | null;
  lastRun: { at: string; ok: boolean; message: string | null } | null;
  redirectUri: string;
}
interface SyncResult { ok: boolean; message: string; connected: boolean }

async function call<T>(method: string, path: string): Promise<T> {
  const res = await fetch(`/api/fitbit${path}`, { method, credentials: "same-origin", headers: method === "GET" ? undefined : { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  // 409 (nicht verbunden) und 503 (Zugangsdaten fehlen) sind Antworten mit Inhalt, keine Abstürze.
  if (!res.ok && res.status !== 409) throw new Error(j.error ?? `Fehler ${res.status}`);
  return j;
}

const key = ["fitbit-status"] as const;
const useStatus = () => useQuery({ queryKey: key, queryFn: () => call<Status>("GET", "/status"), refetchInterval: (q) => (q.state.data?.connected && !q.state.data.lastRun ? 3000 : false) });

function ago(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(min >= 1)) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} Std`;
  return `vor ${Math.floor(min / (24 * 60))} Tagen`;
}

/** Öffnet die Google-Freigabe. Die Adresse kommt vom Server (state und PKCE-Schutz), nie aus dem Code der Oberfläche. */
function useConnect() {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const { url } = await call<{ url: string }>("POST", "/connect");
      window.location.assign(url);
    } catch {
      notify("Nicht möglich");
      setBusy(false);
    }
  }
  return { busy, start };
}

/** Meldung nach der Rückkehr von Google (?fitbit=…), danach die Adresse säubern. */
function useReturnNotice() {
  const qc = useQueryClient();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("fitbit");
    if (!p) return;
    notify(p === "verbunden" ? "Verbunden" : p === "abgelehnt" ? "Nicht freigegeben" : "Verbinden fehlgeschlagen");
    window.history.replaceState(null, "", window.location.pathname);
    void qc.invalidateQueries({ queryKey: key });
  }, [qc]);
}

export function FitbitEinstellungen() {
  const qc = useQueryClient();
  const st = useStatus();
  const { busy, start } = useConnect();
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useReturnNotice();
  const s = st.data;
  if (!s) return null;

  async function sync() {
    setSyncing(true);
    setNote(null);
    try {
      const r = await call<SyncResult>("POST", "/sync");
      setNote({ ok: r.ok, text: r.message });
    } catch {
      setNote({ ok: false, text: "Abgleich nicht möglich" });
    } finally {
      setSyncing(false);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["health"] });
      void qc.invalidateQueries({ queryKey: ["sync-runs"] });
    }
  }
  async function disconnect() {
    try {
      await call("DELETE", "/connection");
    } catch {
      notify("Nicht getrennt");
    }
    void qc.invalidateQueries({ queryKey: key });
  }

  const warn = s.needsReconnect || (s.lastRun && !s.lastRun.ok);
  const detail = note?.text ?? (warn ? (s.lastError ?? s.lastRun?.message ?? "") : "");

  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Fitbit</h2>
      {!s.connected && !s.configured && <div className="faint" style={{ paddingBottom: 12, fontSize: 15 }}>Noch nicht eingerichtet.</div>}
      {!s.connected && s.configured && (
        <button type="button" className="row press" style={{ borderTop: 0 }} disabled={busy} onClick={start}>
          <div className="l"><b>Fitbit verbinden</b></div>
          <span className="r">{busy ? "Öffnet" : ""}</span>
        </button>
      )}
      {s.connected && (
        <>
          <div className="row" style={{ borderTop: 0 }}>
            <div className="l"><b>{s.needsReconnect ? "Neu verbinden" : "Verbunden"}</b></div>
            {s.needsReconnect && <button type="button" className="chip btn press" disabled={busy} onClick={start}>Verbinden</button>}
          </div>
          <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} disabled={syncing} onClick={sync}>
            <div className="l"><b>Jetzt abgleichen</b><span>Zuletzt abgeglichen</span></div>
            <span className="r">{syncing ? "Gleicht ab" : s.lastRun ? ago(s.lastRun.at) : "Noch nie"}</span>
          </button>
          {detail && <div className={warn || note?.ok === false ? "warn" : "faint"} role={warn ? "alert" : undefined} style={{ fontSize: 14, padding: "0 0 12px" }}>{detail}</div>}
          <div style={{ padding: "4px 0 12px" }}><ConfirmDelete label="Trennen" sure="Wirklich trennen" onConfirm={disconnect} /></div>
        </>
      )}
    </div>
  );
}

/** Leerzustand im Körper-Tab: ein Satz, eine Handlung. */
export function FitbitLeer() {
  const st = useStatus();
  const { busy, start } = useConnect();
  useReturnNotice();
  const s = st.data;
  if (s?.connected) return <div className="card"><div className="empty">Noch keine Werte. Die erste Übertragung dauert einen Moment.</div></div>;
  return (
    <div className="card">
      <div className="empty">
        <span>Noch nicht mit Fitbit verbunden.</span>
        {s?.configured ? (
          <button type="button" className="chip btn press" disabled={busy} onClick={start}>Verbinden</button>
        ) : (
          <Link href="/einstellungen" className="chip btn press">Einstellungen</Link>
        )}
      </div>
    </div>
  );
}
