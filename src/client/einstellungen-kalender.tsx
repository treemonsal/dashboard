// Einstellungen: Kalender-Adressen, Abgleich, Hausaufgaben ausblenden und Erinnerungen.
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "./api";
import { ConfirmDelete, Icon, Segments } from "./ui";
import { notify } from "./toast";
import { disablePush, enablePush, pushState, type PushState } from "./push";
import { keys, useAddCalendar, useCalendars, useLastSync, useRemoveCalendar, useSetSetting, useSettings, useSyncCalendars } from "./queries";


function ago(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!(min >= 0)) return "gerade eben";
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} Std`;
  return `vor ${Math.floor(min / (24 * 60))} Tagen`;
}

export function KalenderEinstellungen() {
  const s = useSettings();
  const set = useSetSetting();
  const cals = useCalendars().data ?? [];
  const last = useLastSync().data?.[0];
  const add = useAddCalendar();
  const remove = useRemoveCalendar();
  const sync = useSyncCalendars();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const n = name.trim() || "Kalender";
    add.mutate(
      { id: crypto.randomUUID(), name: n, url: url.trim() },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
          sync.mutate();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : "Nicht gespeichert"),
      },
    );
  }

  const status = sync.isPending ? "Gleicht ab" : last ? ago(last.at) : "Noch nie";
  const failed = sync.isError || (!sync.isPending && !!last && !last.ok);
  const detail = sync.isError ? "Abgleich nicht möglich" : last?.message ?? "";

  return (
    <>
      <div className="card" style={{ paddingTop: 0 }}>
        <h2>Kalender</h2>
        {cals.length === 0 && <div className="faint" style={{ paddingBottom: 10, fontSize: 15 }}>Geheime iCal-Adresse aus Google Kalender (Einstellungen, Kalender integrieren). Nur lesen.</div>}
        {cals.map((c) => (
          <div key={c.id}>
            <div className="row">
              <div className="l"><b>{c.name}</b><span>{c.urlMasked}</span></div>
              <button type="button" className="iconbtn press" aria-label={`${c.name} entfernen`} onClick={() => setAsk(ask === c.id ? null : c.id)}><Icon n="trash" /></button>
            </div>
            {ask === c.id && <div style={{ paddingBottom: 10 }}><ConfirmDelete label="Entfernen" onConfirm={() => { remove.mutate(c.id); setAsk(null); }} /></div>}
          </div>
        ))}
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 12px", borderTop: cals.length ? "1px solid var(--line)" : 0 }}>
          <input className="inp" style={{ width: "100%" }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Name des Kalenders" autoComplete="off" />
          <input className="inp" style={{ width: "100%" }} type="url" placeholder="Adresse (https://calendar.google.com/…)" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} aria-label="Kalender-Adresse" autoComplete="off" autoCapitalize="off" spellCheck={false} />
          {error && <div className="warn" role="alert" style={{ fontSize: 14 }}>{error}</div>}
          <button type="submit" className="cta ghost press" style={{ marginTop: 4 }} disabled={!url.trim() || add.isPending}>{add.isPending ? "Speichert" : "Hinzufügen"}</button>
        </form>
        <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} disabled={sync.isPending || cals.length === 0} onClick={() => sync.mutate()}>
          <div className="l"><b>Jetzt abgleichen</b>{cals.length > 0 && <span>Zuletzt abgeglichen</span>}</div>
          <span className="r">{cals.length === 0 ? "" : status}</span>
        </button>
        {cals.length > 0 && detail && <div className={failed ? "warn" : "faint"} role={failed ? "alert" : undefined} style={{ fontSize: 14, padding: "0 0 12px" }}>{detail}</div>}
        <div className="field">
          <span>Hausaufgaben ausblenden</span>
          <Segments full={false} label="Hausaufgaben ausblenden" value={s.hideHomework === "0" ? "0" : "1"} onChange={(v) => set({ hideHomework: v })} options={[{ v: "0", label: "Aus" }, { v: "1", label: "An" }]} />
        </div>
      </div>
    </>
  );
}

const HINT: Record<PushState, string> = {
  unsupported: "Dieser Browser kann keine Erinnerungen empfangen.",
  "needs-install": "Zuerst zum Home-Bildschirm hinzufügen und die App von dort öffnen.",
  denied: "Mitteilungen sind blockiert. In den iPhone-Einstellungen für diese App erlauben.",
  off: "",
  on: "",
};

export function ErinnerungenEinstellungen() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: keys.pushStatus, queryFn: api.push.status });
  useEffect(() => {
    let live = true;
    void pushState().then((s) => live && setState(s));
    return () => { live = false; };
  }, []);
  const configured = status.data?.configured ?? true;
  const usable = state === "on" || state === "off";

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (on && next === "off") notify("Nicht erlaubt");
    } catch {
      notify("Nicht eingeschaltet");
      setState(await pushState());
    } finally {
      setBusy(false);
      void status.refetch();
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await api.push.test();
      notify(r.sent > 0 ? "Gesendet" : r.removed > 0 ? "Gerät war abgemeldet" : "Nichts gesendet");
    } catch (e) {
      notify(e instanceof ApiError && e.status === 503 ? "Server noch nicht eingerichtet" : "Nicht gesendet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Erinnerungen</h2>
      <div className="field" style={{ borderTop: 0 }}>
        <span>Erinnerungen</span>
        <span className={busy || !usable || !configured ? "dim" : ""}>
          <Segments full={false} label="Erinnerungen" value={state === "on" ? "1" : "0"} onChange={(v) => !busy && usable && configured && void toggle(v === "1")} options={[{ v: "0", label: "Aus" }, { v: "1", label: "An" }]} />
        </span>
      </div>
      {state && HINT[state] && <div className="faint" style={{ fontSize: 14, padding: "0 0 12px" }}>{HINT[state]}</div>}
      {state && usable && !configured && <div className="faint" style={{ fontSize: 14, padding: "0 0 12px" }}>Der Server hat noch keinen Schlüssel für Erinnerungen.</div>}
      {state === "on" && (
        <button type="button" className="row press" style={{ borderTop: "1px solid var(--line)" }} disabled={busy} onClick={test}>
          <div className="l"><b>Test-Erinnerung</b></div>
          <Icon n="chev" />
        </button>
      )}
    </div>
  );
}
