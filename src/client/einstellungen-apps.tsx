// Einstellungen: verbundene Apps (Connector) widerrufen und die letzten Abgleiche.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ConnectorGrant } from "./api";
import { ago } from "./einstellungen-kalender";
import { useSheet } from "./sheet";
import { notify } from "./toast";
import { ConfirmDelete, Icon } from "./ui";
import { dayCompact, todayInZone } from "../shared/dates";

const grantsKey = ["connector-grants"] as const;
const runsKey = ["sync-runs"] as const;

const RIGHTS: Record<string, string> = { tasks: "Aufgaben", calendar: "Termine", school: "Schule", gym: "Gym", "money:read": "Geld", "health:read": "Körper" };
const rights = (g: ConnectorGrant) => [...new Set(g.scope.map((s) => RIGHTS[s]).filter(Boolean))].join(", ");
const connectorUrl = () => `${location.origin}/mcp`;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Kopiert");
  } catch {
    notify("Nicht kopiert");
  }
}

function GrantSheet({ grant }: { grant: ConnectorGrant }) {
  const sheet = useSheet();
  const qc = useQueryClient();
  async function revoke() {
    try {
      await api.connector.revoke(grant.id);
      qc.setQueryData<ConnectorGrant[]>(grantsKey, (d) => (d ?? []).filter((x) => x.id !== grant.id));
      sheet.close();
    } catch {
      notify("Nicht widerrufen");
    }
  }
  return (
    <div>
      <h3>{grant.clientName ?? "App"}</h3>
      <div className="when">Verbunden am {dayCompact(grant.createdAt.slice(0, 10))}</div>
      <div className="field" style={{ borderTop: 0 }}><span>Zugriff auf</span><span className="rt">{rights(grant) || "–"}</span></div>
      <div style={{ marginTop: 18 }}>
        <ConfirmDelete label="Zugriff widerrufen" sure="Ja, widerrufen" onConfirm={revoke} />
      </div>
    </div>
  );
}

export function VerbundeneApps() {
  const sheet = useSheet();
  const q = useQuery({ queryKey: grantsKey, queryFn: api.connector.grants });
  const list = q.data ?? [];
  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Verbundene Apps</h2>
      {q.isError && <div className="empty">Nicht geladen.</div>}
      {q.isSuccess && list.length === 0 && (
        <div className="empty">
          <span>Noch keine App verbunden</span>
          <button type="button" className="chip btn press addr" onClick={() => void copy(connectorUrl())}>{connectorUrl().replace(/^https?:\/\//, "")}</button>
        </div>
      )}
      {list.map((g) => (
        <button key={g.id} type="button" className="row press" onClick={() => sheet.open(<GrantSheet grant={g} />)}>
          <div className="l"><b>{g.clientName ?? "App"}</b><span>{rights(g)}</span></div>
          <Icon n="chev" />
        </button>
      ))}
    </div>
  );
}

const KIND: Record<string, string> = { kalender: "Kalender", schule: "Schule", fitbit: "Fitbit", gesundheit: "Fitbit" };

export function AbgleichLaeufe() {
  const q = useQuery({ queryKey: runsKey, queryFn: () => api.syncRuns(30) });
  const today = todayInZone();
  const runs = (q.data ?? []).filter((r) => KIND[r.kind]).slice(0, 8);
  if (!q.isSuccess) return null;
  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Abgleich</h2>
      {runs.length === 0 && <div className="empty">Noch kein Abgleich gelaufen</div>}
      {runs.map((r) => (
        <div key={r.id} className="row">
          <div className="l"><b>{KIND[r.kind]}</b>{!r.ok && <span className="warn">{r.message || "Fehlgeschlagen"}</span>}</div>
          <span className="r">{r.at.slice(0, 10) === today || Date.now() - Date.parse(r.at) < 36 * 3600_000 ? ago(r.at) : dayCompact(r.at.slice(0, 10))}</span>
        </div>
      ))}
    </div>
  );
}
