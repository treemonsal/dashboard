// Fitbit (Google Health): verbinden, Status, abgleichen, trennen. Eingehängt in Einstellungen und im Leerzustand des Körper-Tabs.
// Eigene kleine API-Hülle, damit api.ts und queries.ts unberührt bleiben.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDelete } from "./ui";
import { notify } from "./toast";
import { useSheet } from "./sheet";
import { FitbitSetupSheet, call, statusKey, useStatus } from "./fitbit-setup";

interface SyncResult { ok: boolean; message: string; connected: boolean }

const key = statusKey;
function ago(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(min >= 1)) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} Std`;
  return `vor ${Math.floor(min / (24 * 60))} Tagen`;
}

/** Öffnet die Google-Freigabe. Die Adresse kommt vom Server (state und PKCE-Schutz), nie aus dem Code der Oberfläche. */
export function useConnect() {
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
  const sheet = useSheet();
  const conn = useConnect();
  const { busy, start } = conn;
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
      {!s.connected && (
        <button type="button" className="row press" style={{ borderTop: 0 }} onClick={() => sheet.open(<FitbitSetupSheet connect={conn} />)}>
          <div className="l"><b>{s.configured ? "Einrichtung" : "Einrichten"}</b></div>
          <span className="r">{Math.min(7, new Set([...s.setup, ...(s.credentials.present ? [6] : [])]).size)} von 7</span>
        </button>
      )}
      {!s.connected && s.configured && (
        <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} disabled={busy} onClick={start}>
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
          <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} onClick={() => sheet.open(<FitbitSetupSheet connect={conn} />)}>
            <div className="l"><b>Zugangsdaten</b></div>
            <span className="r">{s.credentials.present ? "Eingetragen" : "Fehlen"}</span>
          </button>
          <div style={{ padding: "4px 0 12px" }}><ConfirmDelete label="Trennen" sure="Wirklich trennen" onConfirm={disconnect} /></div>
        </>
      )}
    </div>
  );
}

/** Leerzustand im Körper-Tab: ein Satz, eine Handlung. */
export function FitbitLeer() {
  const st = useStatus();
  const sheet = useSheet();
  const conn = useConnect();
  const { busy, start } = conn;
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
          <button type="button" className="chip btn press" onClick={() => sheet.open(<FitbitSetupSheet connect={conn} />)}>Einrichten</button>
        )}
      </div>
    </div>
  );
}
