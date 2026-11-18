// Buchungen im laufenden Monat: vorläufige Buchungen, Eingabe von Hand, Kontostand, Einrichtung des Kurzbefehls.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, intake } from "./api";
import { copy } from "./fitbit-setup";
import { Link } from "./router";
import { useSheet } from "./sheet";
import { notify } from "./toast";
import { ActFace, ConfirmDelete, Icon, Money, nf } from "./ui";
import { useAccounts, useAllTransactions, useCategories, useSetSetting, useSettings, useToday } from "./queries";
import { saldoAbgleich, type SaldoErgebnis } from "../shared/saldo";
import { merchantOf } from "../shared/tiefe";
import type { Account, Category, Transaction } from "../shared/schemas";

export const isProvisional = (t: { state?: string }) => t.state === "provisional";

/** Leiser Hinweis in Listen: hohler Punkt, ohne Text. */
export const ProvDot = () => <i className="pdot" role="img" aria-label="vorläufig" />;

/** Vorläufig, aber im abgedeckten Zeitraum eines Auszugs nicht vorhanden. */
export const notInStatement = (t: Transaction, accs: Account[]) => {
  if (!isProvisional(t)) return false;
  const a = accs.find((x) => x.id === t.accountId);
  return !!a?.coveredThrough && t.date <= a.coveredThrough;
};

export function saldoOf(a: Account, txs: Transaction[]): SaldoErgebnis {
  const anchor = a.anchorBalance != null && a.anchorDay ? { balance: a.anchorBalance, day: a.anchorDay, kind: a.anchorKind === "eingabe" ? ("eingabe" as const) : ("auszug" as const), at: a.anchorAt } : null;
  const entered = a.enteredBalance != null && a.enteredDay && a.enteredAt ? { balance: a.enteredBalance, day: a.enteredDay, at: a.enteredAt } : null;
  return saldoAbgleich(anchor, entered, txs.filter((t) => t.accountId === a.id).map((t) => ({ date: t.date, amount: t.amount, createdAt: t.createdAt ?? "", provisional: isProvisional(t) })));
}

/** Nicht erfasster Betrag je Konto, nur im Monat der Eingabe. Wird in "Übrig" als eigene Zeile abgezogen. */
export function useUnrecorded(month: string) {
  const accs = useAccounts().data ?? [];
  const txs = useAllTransactions().data ?? [];
  return useMemo(() => {
    const items = accs.map((a) => ({ account: a, r: saldoOf(a, txs) })).filter((x) => x.r.unrecorded > 0 && x.r.day?.startsWith(month)).map((x) => ({ account: x.account, amount: x.r.unrecorded }));
    return { items, total: items.reduce((s, x) => s + x.amount, 0) };
  }, [accs, txs, month]);
}

/** Zeile "Nicht erfasst" unter Ausgegeben; führt zum Konto, wo ein Tipp daraus eine Buchung macht. */
export function UnrecordedRows({ month }: { month: string }) {
  const u = useUnrecorded(month);
  if (!u.items.length) return null;
  return (
    <div className="card tap">
      {u.items.map((x) => (
        <Link key={x.account.id} href={`/geld/konto/${x.account.id}`} className="lrow press">
          <span className="ic"><Icon n="dots" /></span>
          <span className="w"><b>Nicht erfasst</b><span>{x.account.name}</span></span>
          <span className="a"><Money v={x.amount} size={17} cur={false} /><Icon n="chev" className="go" /></span>
        </Link>
      ))}
    </div>
  );
}

const parseNum = (s: string) => { const n = parseFloat(s.replace(",", ".")); return Number.isFinite(n) ? n : null; };

/** Schnelle Eingabe: Betrag gross, Händler, Kategorie, Konto. Eingabefeld oben im Blatt. */
export function QuickAddSheet() {
  const sheet = useSheet();
  const qc = useQueryClient();
  const today = useToday();
  const accs = useAccounts().data ?? [];
  const cats = useCategories().data ?? [];
  const txs = useAllTransactions().data ?? [];
  const settings = useSettings();
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [catId, setCatId] = useState<string | null>(null);
  const [accId, setAccId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const acc = accId || accs.find((a) => a.name.toLowerCase() === settings.eingangKonto.toLowerCase())?.id || accs[0]?.id || "";
  // Händler und ihre häufigste Kategorie aus bisherigen Buchungen
  const known = useMemo(() => {
    const m = new Map<string, { name: string; n: number; cats: Map<string, number> }>();
    for (const t of txs) {
      if (t.amount >= 0 || !t.description) continue;
      const mm = merchantOf(t.description);
      const e = m.get(mm.key) ?? { name: mm.name, n: 0, cats: new Map() };
      e.n++;
      if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1);
      m.set(mm.key, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [txs]);
  const q = merchant.trim().toLowerCase();
  const sugg = (q ? known.filter((k) => k.name.toLowerCase().includes(q) && k.name.toLowerCase() !== q) : known).slice(0, 4);
  const topCat = (name: string): string | null => {
    const e = known.find((k) => k.name === name);
    return e ? ([...e.cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;
  };
  const chosenCat = catId ?? topCat(merchant.trim()) ?? null;
  const n = parseNum(amount);
  const ok = n !== null && n > 0 && merchant.trim().length > 0 && !!acc && !busy;
  async function save() {
    if (!ok) return;
    setBusy(true);
    try {
      await api.money.addProvisional({ accountId: acc, merchant: merchant.trim(), amount: n!, date: today, ...(chosenCat ? { categoryId: chosenCat } : {}) });
      await Promise.all([qc.invalidateQueries({ queryKey: ["tx"] }), qc.invalidateQueries({ queryKey: ["accounts"] })]);
      sheet.close();
    } catch {
      notify("Nicht gespeichert");
      setBusy(false);
    }
  }
  return (
    <div>
      {/* Felder ganz oben: das iPhone verschiebt die Seite sonst beim Tippen. */}
      <div className="qa-top">
        <input className="qa-amt" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="Betrag" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="inp" placeholder="Händler" aria-label="Händler" autoComplete="off" maxLength={120} value={merchant} onChange={(e) => { setMerchant(e.target.value); setCatId(null); }} />
      </div>
      {sugg.length > 0 && <div className="fs-a">{sugg.map((k) => <button key={k.name} type="button" className="chip btn press" onClick={() => { setMerchant(k.name); setCatId(null); }}>{k.name}</button>)}</div>}
      <div className="sec">Kategorie</div>
      <div className="fs-a">{cats.map((c: Category) => <button key={c.id} type="button" className="chip btn press" aria-pressed={chosenCat === c.id} onClick={() => setCatId(c.id)}>{c.name}</button>)}</div>
      {accs.length > 1 && <><div className="sec">Konto</div><div className="fs-a">{accs.map((a) => <button key={a.id} type="button" className="chip btn press" aria-pressed={acc === a.id} onClick={() => setAccId(a.id)}>{a.name}</button>)}</div></>}
      <button type="button" className="cta press" disabled={!ok} onClick={save}>Speichern</button>
    </div>
  );
}

export function QuickAddAction() {
  const sheet = useSheet();
  return (
    <button type="button" className="act press" aria-label="Buchung hinzufügen" onClick={() => sheet.open(<QuickAddSheet />)}>
      <ActFace icon="plus" text="Buchung" />
    </button>
  );
}

/** Teil der Buchungsansicht: vorläufige Buchung ändern (Betrag) und löschen, Tipp bei "nicht im Auszug". */
export function ProvisionalTools({ t, accs, onGone }: { t: Transaction; accs: Account[]; onGone: () => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(String(Math.abs(t.amount)));
  const missing = notInStatement(t, accs);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["tx"] }), qc.invalidateQueries({ queryKey: ["accounts"] })]);
  async function saveAmount() {
    const n = parseNum(val);
    if (n === null || n <= 0 || n === Math.abs(t.amount)) { setVal(String(Math.abs(t.amount))); return; }
    try { await api.money.updateTx(t.id, { amount: -n }); await refresh(); } catch { notify("Nicht gespeichert"); }
  }
  async function remove() {
    try { await api.money.removeTx(t.id); await refresh(); onGone(); } catch { notify("Nicht gelöscht"); }
  }
  return (
    <>
      {missing && <div className="card"><p className="orig">Nicht im Auszug. Behalten, wenn die Zahlung noch kommt, sonst löschen.</p></div>}
      <div className="card" style={{ paddingTop: 0 }}>
        <div className="kv" style={{ alignItems: "center" }}><label htmlFor="pv-a">Betrag</label><input id="pv-a" className="inp num" style={{ width: 110 }} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onBlur={saveAmount} /></div>
      </div>
      <ConfirmDelete label="Buchung löschen" sure="Ja, löschen" onConfirm={remove} />
    </>
  );
}

/** Konto-Detail: Kontostand eintippen, Differenz als "nicht erfasst", Tipp zum Verbuchen. */
export function KontoStand({ a, txs }: { a: Account; txs: Transaction[] }) {
  const qc = useQueryClient();
  const [val, setVal] = useState("");
  const r = saldoOf(a, txs);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["tx"] }), qc.invalidateQueries({ queryKey: ["accounts"] })]);
  async function save() {
    const n = parseNum(val);
    if (n === null) return;
    try { await api.money.setBalance(a.id, n); setVal(""); await refresh(); } catch { notify("Nicht gespeichert"); }
  }
  async function book() {
    try { await api.money.bookUnrecorded(a.id); await refresh(); } catch { notify("Nicht gebucht"); }
  }
  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Kontostand</h2>
      <div className="kv" style={{ alignItems: "center" }}>
        <label htmlFor="ks">Jetzt auf dem Konto</label>
        <input id="ks" className="inp num" style={{ width: 120 }} inputMode="decimal" placeholder={a.enteredBalance != null ? nf(a.enteredBalance, 2) : "0.00"} value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => val && void save()} />
      </div>
      {r.state === "kein-anker" && <p className="orig">Noch kein Saldo aus einem Auszug. Die erste Eingabe gilt als Ausgangspunkt.</p>}
      {r.unrecorded > 0 && (
        <div className="kv" style={{ alignItems: "center" }}>
          <span>Nicht erfasst</span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}><Money v={r.unrecorded} size={17} cur={false} /><button type="button" className="chip btn press" onClick={book}>Als Buchung</button></span>
        </div>
      )}
      {r.state === "differenz" && r.unrecorded === 0 && <div className="kv"><span>Mehr als gebucht</span><Money v={r.diff} size={17} cur={false} signed /></div>}
    </div>
  );
}

/* ---------- Einrichtung des Kurzbefehls ---------- */
const statusKey = ["eingang"] as const;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "gerade eben";
  if (m < 60) return `${m} Min.`;
  if (m < 48 * 60) return `${Math.round(m / 60)} Std.`;
  return `${Math.round(m / 1440)} Tage`;
};
export const useIntake = () => useQuery({ queryKey: statusKey, queryFn: intake.status });

function Step({ n, text, children }: { n: number; text: string; children?: React.ReactNode }) {
  return (
    <li className="fs">
      <span className="fs-n">{n}</span>
      <div className="fs-b"><p>{text}</p>{children && <div className="fs-a">{children}</div>}</div>
    </li>
  );
}
const CopyBtn = ({ text, label }: { text: string; label: string }) => <button type="button" className="chip btn press" onClick={() => copy(text)}>{label}</button>;

export function IntakeSheet() {
  const qc = useQueryClient();
  const st = useIntake();
  const accs = useAccounts().data ?? [];
  const settings = useSettings();
  const setS = useSetSetting();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `${location.origin}/eingang/buchung`;
  const s = st.data;
  const refresh = () => qc.invalidateQueries({ queryKey: statusKey });
  async function make() {
    setBusy(true);
    try { setKey((await intake.newKey()).key); await refresh(); } catch { notify("Nicht erzeugt"); } finally { setBusy(false); }
  }
  async function revoke() {
    try { await intake.revoke(); setKey(null); await refresh(); } catch { notify("Nicht widerrufen"); }
  }
  async function test() {
    try { const r = await intake.test(); notify(r.ok ? `Test ok, Konto ${r.account}` : "Test fehlgeschlagen: Konto nicht gefunden"); } catch { notify("Test fehlgeschlagen"); }
  }
  return (
    <div>
      <h3>Kurzbefehl einrichten</h3>
      <div className="when">{s?.lastAt ? `Letzter Eingang vor ${ago(s.lastAt)}` : "Noch kein Eingang"}</div>
      <p className="fs-note" style={{ marginTop: 6 }}>Funktioniert nur für Zahlungen mit Apple Pay. Twint, Überweisungen und Online-Zahlungen kommen erst mit dem Auszug oder von Hand.</p>
      <ol className="fs-l">
        <Step n={1} text="Schlüssel erzeugen. Er wird nur jetzt einmal angezeigt.">
          {key ? (
            <>
              <code className="orig" style={{ overflowWrap: "anywhere", width: "100%" }}>{key}</code>
              <CopyBtn text={key} label="Schlüssel kopieren" />
            </>
          ) : (
            <button type="button" className="chip btn press" disabled={busy} onClick={make}>{s?.active ? "Neuen Schlüssel erzeugen" : "Schlüssel erzeugen"}</button>
          )}
          {s?.active && !key && <div className="fs-ok">Ein Schlüssel ist aktiv. Ein neuer macht den alten ungültig.</div>}
        </Step>
        <Step n={2} text="Öffne die App «Kurzbefehle» (Shortcuts), tippe «Automation» und «+», wähle «Transaktion» (Transaction).">
          <CopyBtn text="Transaktion" label="Name kopieren" />
        </Step>
        <Step n={3} text="Wähle deine Karten aus Wallet (Revolut, Yuh, ZKB) und «Sofort ausführen» (Run Immediately).">
        </Step>
        <Step n={4} text="Füge die Aktion «Inhalte von URL abrufen» (Get Contents of URL) hinzu und trage diese Adresse ein.">
          <CopyBtn text={url} label="Adresse kopieren" />
        </Step>
        <Step n={5} text="Tippe «Mehr zeigen» (Show More). Methode «POST», Header «Authorization» mit dem Wert «Bearer » und dem Schlüssel.">
          <CopyBtn text="Authorization" label="Header kopieren" />
          {key && <CopyBtn text={`Bearer ${key}`} label="Wert kopieren" />}
        </Step>
        <Step n={6} text="Anfragetext «JSON» (Request Body) mit drei Feldern: merchant (Händler), amount (Betrag), card (Karte). Die Werte wählst du aus den Variablen der Transaktion.">
          <CopyBtn text={"merchant\namount\ncard"} label="Feldnamen kopieren" />
        </Step>
        <Step n={7} text="Standardkonto, wenn der Kartenname zu keinem Konto passt.">
          {accs.map((a) => <button key={a.id} type="button" className="chip btn press" aria-pressed={settings.eingangKonto.toLowerCase() === a.name.toLowerCase()} onClick={() => setS({ eingangKonto: a.name })}>{a.name}</button>)}
        </Step>
        <Step n={8} text="Prüfe die Einrichtung.">
          <button type="button" className="chip btn press" disabled={!s?.active} onClick={test}>Test senden</button>
        </Step>
      </ol>
      <p className="fs-note">Der Kartenname muss den Namen des Kontos enthalten, damit die Buchung auf dem richtigen Konto landet.</p>
      {s?.active && <ConfirmDelete label="Schlüssel widerrufen" sure="Ja, widerrufen" onConfirm={revoke} />}
    </div>
  );
}

/** Zeile in den Einstellungen. */
export function IntakeCard() {
  const sheet = useSheet();
  const s = useIntake().data;
  return (
    <div className="card" style={{ paddingTop: 0 }}>
      <h2>Eingang</h2>
      <button type="button" className="row press" onClick={() => sheet.open(<IntakeSheet />)}>
        <div className="l"><b>Kurzbefehl</b><span>{s?.active ? (s.lastAt ? `Letzter Eingang vor ${ago(s.lastAt)}` : "Eingerichtet") : "Nicht eingerichtet"}</span></div>
        <Icon n="chev" />
      </button>
    </div>
  );
}
