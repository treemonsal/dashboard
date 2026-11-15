// Geld in die Tiefe. Jede Stufe hat eine eigene Adresse unter /geld/...; Zurück führt genau eine Stufe zurück.
//   analyse/<monat>[/w<n>][/<kategorie>]      Monat, Woche, Kategorie, Buchungen
//   ausgegeben/<monat>, tag/<datum>           Verlauf, Tag
//   buchungen/<monat>, konto/<id>, mama       Listen
//   <liste>/buchung/<id>[/haendler]           Buchung und gleicher Händler, immer unter der Liste, aus der man kam
//   depot, depot/<kürzel>, depot/stand/<datum>
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryNotice } from "./query-state";
import { Link } from "./router";
import { addDays, dayCompact } from "../shared/dates";
import { byCategory, mamaBalance, ownShare } from "../shared/geld";
import { depotHoldings, portfolioProduct } from "../shared/depot";
import { inWeek, merchantOf, monthsWithData, sameMerchant, shiftMonth, slug, spendPerDay, spendSum, sumsByWeek, weeksOfMonth } from "../shared/tiefe";
import type { Category, Transaction } from "../shared/schemas";
import { Money, Icon, nf } from "./ui";
import { navigate } from "./router";
import { NotFound, Stage, monthName, type Crumb } from "./tiefe";
import { CatIcon, DepotSheet, SpendChart, TxRow, pctText, useDepot } from "./geld";
import { useSheet } from "./sheet";
import { useAccounts, useAllTransactions, useCategories, useSettings, useToday, useUpdateTx } from "./queries";
import { api } from "./api";

const href = (...s: string[]) => `/geld${s.length ? "/" + s.join("/") : ""}`;
const day = (d: string) => dayCompact(d);

function useData() {
  const tx = useAllTransactions();
  const cats = useCategories();
  const accs = useAccounts();
  return { txs: tx.data ?? [], cats: cats.data ?? [], accs: accs.data ?? [], ok: tx.isSuccess && cats.isSuccess && accs.isSuccess, pending: tx.isPending || cats.isPending || accs.isPending, error: tx.error ?? cats.error ?? accs.error };
}
type D = ReturnType<typeof useData>;

const catOf = (cats: Category[], s: string) => cats.find((c) => slug(c.name) === s);
const catName = (cats: Category[], id: string | null) => cats.find((c) => c.id === id)?.name ?? "Ohne Kategorie";

function MonthNav({ month, today, to }: { month: string; today: string; to: (m: string) => string }) {
  const thisMonth = today.slice(0, 7);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button type="button" className="iconbtn press" aria-label="Voriger Monat" onClick={() => navigate(to(shiftMonth(month, -1)), { replace: true })}><Icon n="back" /></button>
      <span className="chip">{monthName(month, today)}</span>
      <button type="button" className="iconbtn press" aria-label="Nächster Monat" style={{ transform: "scaleX(-1)" }} disabled={month >= thisMonth} onClick={() => navigate(to(shiftMonth(month, 1)), { replace: true })}><Icon n="back" /></button>
    </div>
  );
}

/** Buchungen als Zeilen; jede führt zur Buchung unter `base`. */
function TxList({ txs, d, base, empty = "Keine Buchungen." }: { txs: Transaction[]; d: D; base: string[]; empty?: string }) {
  if (!txs.length) return <div className="card"><div className="empty">{empty}</div></div>;
  return <div className="card">{txs.map((t) => <TxRow key={t.id} t={t} cats={d.cats} base={base} />)}</div>;
}
const newestFirst = (a: Transaction, b: Transaction) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

/* ---------- Einstieg ---------- */
export function GeldTiefe({ path }: { path: string }) {
  const segs = path.split("/").filter(Boolean).slice(1);
  const d = useData();
  const today = useToday();
  if (!d.ok) return <Stage title="Geld" back="/geld"><QueryNotice pending={d.pending} error={d.error} /></Stage>;
  const n = segs.length;
  if (n >= 2 && segs[n - 2] === "buchung") return <Buchung d={d} segs={segs} today={today} />;
  if (n >= 3 && segs[n - 1] === "haendler" && segs[n - 3] === "buchung") return <Haendler d={d} segs={segs} today={today} />;
  switch (segs[0]) {
    case "analyse": return <Analyse d={d} segs={segs} today={today} />;
    case "ausgegeben": return <Ausgegeben d={d} month={segs[1] ?? today.slice(0, 7)} today={today} />;
    case "tag": return <Tag d={d} date={segs[1] ?? today} today={today} />;
    case "buchungen": return <Monatsliste d={d} month={segs[1] ?? today.slice(0, 7)} today={today} />;
    case "konto": return <Konto d={d} id={segs[1] ?? ""} today={today} />;
    case "mama": return <Mama d={d} />;
    case "depot": return <Depot segs={segs} />;
    default: return <Stage title="Geld" back="/geld"><NotFound /></Stage>;
  }
}

/* ---------- Analyse: Monat, Woche, Kategorie ---------- */
function Analyse({ d, segs, today }: { d: D; segs: string[]; today: string }) {
  const month = /^\d{4}-\d{2}$/.test(segs[1] ?? "") ? segs[1]! : today.slice(0, 7);
  const rest = segs.slice(2);
  const wk = /^w([1-5])$/.exec(rest[0] ?? "");
  const week = wk ? Number(wk[1]) : null;
  const catSlug = week ? rest[1] : rest[0];
  const base = ["analyse", month];
  const mTxs = d.txs.filter((t) => t.date.startsWith(month));
  const wTxs = week ? inWeek(mTxs, month, week) : mTxs;
  const mCrumb: Crumb = { label: monthName(month, today), href: href(...base) };
  const wDef = week ? weeksOfMonth(month).find((w) => w.n === week) : undefined;
  const wCrumb: Crumb | null = week ? { label: `Woche ${week}`, href: href(...base, `w${week}`) } : null;
  if (week && !wDef) return <Stage title="Analyse" back={href(...base)}><NotFound /></Stage>;

  // Kategorie: Buchungen
  if (catSlug) {
    const sel = wTxs.filter((t) => ownShare(t) > 0 && slug(catName(d.cats, t.categoryId)) === catSlug);
    const name = sel.length ? catName(d.cats, sel[0]!.categoryId) : (catOf(d.cats, catSlug)?.name ?? "Ohne Kategorie");
    const parent = week ? [...base, `w${week}`] : base;
    return (
      <Stage title={name} back={href(...parent)} crumbs={[mCrumb, ...(wCrumb ? [wCrumb] : []), { label: name }]}>
        <div className="center"><Money v={spendSum(sel)} size={44} /><span className="lbl">{sel.length} {sel.length === 1 ? "Buchung" : "Buchungen"}</span></div>
        <TxList txs={[...sel].sort(newestFirst)} d={d} base={[...parent, catSlug]} empty="Keine Ausgaben in dieser Kategorie." />
      </Stage>
    );
  }
  const by = byCategory(wTxs);
  const total = spendSum(wTxs);
  const CatRows = ({ parent }: { parent: string[] }) => (
    <div className="card">
      <h2>Kategorien</h2>
      {by.length === 0 && <div className="empty">Keine Ausgaben.</div>}
      {by.map((b) => {
        const name = catName(d.cats, b.categoryId);
        const n = wTxs.filter((t) => (t.categoryId ?? null) === b.categoryId && ownShare(t) > 0).length;
        return (
          <Link key={b.categoryId ?? "none"} href={href(...parent, slug(name))} className="lrow press">
            <CatIcon name={name} />
            <span className="w"><b>{name}</b><span>{n} {n === 1 ? "Buchung" : "Buchungen"} · {total ? Math.round((b.amount / total) * 100) : 0} %</span></span>
            <span className="a"><Money v={b.amount} size={17} cur={false} /><Icon n="chev" className="go" /></span>
          </Link>
        );
      })}
    </div>
  );
  // Woche: Ausgaben nach Kategorie
  if (week && wDef) {
    return (
      <Stage title={`Woche ${week}`} back={href(...base)} crumbs={[mCrumb, { label: `Woche ${week}` }]}>
        <div className="center"><Money v={total} size={44} /><span className="lbl">{day(wDef.from)} bis {day(wDef.to)}</span></div>
        <CatRows parent={[...base, `w${week}`]} />
      </Stage>
    );
  }
  // Monat
  const weeks = weeksOfMonth(month);
  const sums = sumsByWeek(mTxs, month);
  const mx = Math.max(1, ...sums);
  const months = monthsWithData(d.txs);
  return (
    <Stage title="Analyse" back="/geld" crumbs={[{ label: monthName(month, today) }]}>
      <div className="center">
        {mTxs.length ? <Money v={total} size={44} /> : <span className="bigv faint" style={{ fontSize: 44 }}>–</span>}
        <MonthNav month={month} today={today} to={(m) => href("analyse", m)} />
        {mTxs.length === 0 && months[0] && <Link href={href("analyse", months[0])} className="chip btn press">Zu {monthName(months[0], today)}</Link>}
      </div>
      {mTxs.length === 0 ? <div className="card"><div className="empty">Keine Buchungen in diesem Monat.</div></div> : (
        <>
          <div className="card">
            <h2>Pro Woche</h2>
            <div className="wbars">
              {weeks.map((w, i) => (
                <Link key={w.n} href={href(...base, `w${w.n}`)} className="press" aria-label={`Woche ${w.n}, ${nf(sums[i]!)}`}>
                  <span>{nf(sums[i]!)}</span><i className={sums[i] === 0 ? "dim" : ""} style={{ height: `${(sums[i]! / mx) * 80}%` }} /><span>{Number(w.from.slice(8))}–{Number(w.to.slice(8))}</span>
                </Link>
              ))}
            </div>
            <div style={{ height: 14 }} />
          </div>
          <CatRows parent={base} />
        </>
      )}
    </Stage>
  );
}

/* ---------- Ausgegeben, Tag ---------- */
function Ausgegeben({ d, month, today }: { d: D; month: string; today: string }) {
  const s = useSettings();
  const budget = Math.max(0, Number(s.salary) - Number(s.investMonthly));
  const txs = d.txs.filter((t) => t.date.startsWith(month));
  const per = spendPerDay(txs, month);
  const days = per.map((v, i) => ({ date: `${month}-${String(i + 1).padStart(2, "0")}`, v })).filter((x) => x.v > 0).reverse();
  return (
    <Stage title="Ausgegeben" back="/geld" crumbs={[{ label: monthName(month, today) }]}>
      <div className="center">
        {txs.length ? <Money v={spendSum(txs)} size={44} /> : <span className="bigv faint" style={{ fontSize: 44 }}>–</span>}
        <MonthNav month={month} today={today} to={(m) => href("ausgegeben", m)} />
      </div>
      {txs.length > 0 && <div className="card"><h2>Verlauf</h2><div style={{ paddingBottom: 14 }}><SpendChart txs={txs} month={month} budget={budget} today={today} dayHref={(x) => href("tag", x)} /></div></div>}
      <div className="card">
        <h2>Tage</h2>
        {days.length === 0 && <div className="empty">Keine Ausgaben.</div>}
        {days.map((x) => (
          <Link key={x.date} href={href("tag", x.date)} className="lrow nopic press">
            <span className="w"><b>{day(x.date)}</b><span>{txs.filter((t) => t.date === x.date).length} Buchungen</span></span>
            <span className="a"><Money v={x.v} size={17} cur={false} /><Icon n="chev" className="go" /></span>
          </Link>
        ))}
      </div>
    </Stage>
  );
}

function Tag({ d, date, today }: { d: D; date: string; today: string }) {
  const txs = d.txs.filter((t) => t.date === date);
  const month = date.slice(0, 7);
  return (
    <Stage title={day(date)} back={href("ausgegeben", month)} crumbs={[{ label: monthName(month, today), href: href("ausgegeben", month) }, { label: day(date) }]}>
      <div className="center"><Money v={spendSum(txs)} size={44} /><span className="lbl">ausgegeben</span></div>
      <div className="wknav" style={{ justifyContent: "center", gap: 16 }}>
        <Link href={href("tag", addDays(date, -1))} className="iconbtn press" aria-label="Vorheriger Tag"><Icon n="back" /></Link>
        <Link href={href("tag", addDays(date, 1))} className="iconbtn press" aria-label="Nächster Tag"><Icon n="chev" /></Link>
      </div>
      <TxList txs={txs} d={d} base={["tag", date]} empty="Keine Buchungen an diesem Tag." />
    </Stage>
  );
}

function Monatsliste({ d, month, today }: { d: D; month: string; today: string }) {
  const txs = d.txs.filter((t) => t.date.startsWith(month)).sort(newestFirst);
  return (
    <Stage title="Buchungen" back="/geld" crumbs={[{ label: monthName(month, today) }]}>
      <div className="center"><MonthNav month={month} today={today} to={(m) => href("buchungen", m)} /></div>
      <TxList txs={txs} d={d} base={["buchungen", month]} empty="Keine Buchungen in diesem Monat." />
    </Stage>
  );
}

/* ---------- Konto ---------- */
function Konto({ d, id, today }: { d: D; id: string; today: string }) {
  const a = d.accs.find((x) => x.id === id);
  if (!a) return <Stage title="Konto" back="/geld"><NotFound /></Stage>;
  const txs = d.txs.filter((t) => t.accountId === id).sort(newestFirst);
  const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))];
  return (
    <Stage title={a.name} back="/geld" crumbs={[{ label: a.name }]}>
      <div className="center"><Money v={a.balance} size={44} /><span className="lbl">{txs.length} Buchungen</span></div>
      {txs.length === 0 && <div className="card"><div className="empty">Keine Buchungen auf diesem Konto.</div></div>}
      {months.map((m) => (
        <div key={m} className="card">
          <h2><span>{monthName(m, today)}</span><span>{nf(spendSum(txs.filter((t) => t.date.startsWith(m))))} ausgegeben</span></h2>
          {txs.filter((t) => t.date.startsWith(m)).map((t) => <TxRow key={t.id} t={t} cats={d.cats} base={["konto", id]} />)}
        </div>
      ))}
    </Stage>
  );
}

/* ---------- Offen von Mama ---------- */
function Mama({ d }: { d: D }) {
  const name = useSettings().mamaName;
  const upd = useUpdateTx();
  const m = useMemo(() => mamaBalance(d.txs), [d.txs]);
  const open = m.meals.filter((x) => x.status !== "settled").reverse();
  const done = m.meals.filter((x) => x.status === "settled").reverse();
  const Row = ({ x }: { x: (typeof m.meals)[number] }) => (
    <div className="lrow" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
      <Link href={href("mama", "buchung", x.tx.id)} className="w press" style={{ display: "block" }}>
        <b>{x.tx.description ? merchantOf(x.tx.description).name : "Mahlzeit"}</b>
        <span>{day(x.tx.date)}{x.status === "partial" ? ` · ${nf(x.covered, 2)} erhalten` : ""}</span>
      </Link>
      <span className="a"><Money v={x.expected} size={17} cur={false} /></span>
      <button type="button" className="chip btn press" onClick={() => upd.mutate({ id: x.tx.id, patch: { settled: !x.tx.settledAt } })}>{x.tx.settledAt ? "Öffnen" : "Beglichen"}</button>
    </div>
  );
  return (
    <Stage title="Offen von Mama" back="/geld" crumbs={[{ label: name || "Offen von Mama" }]}>
      <div className="center"><Money v={m.open} size={44} /><span className="lbl">Hälfte der Mahlzeiten auswärts</span></div>
      <div className="card">
        <h2>Offen</h2>
        {open.length === 0 && <div className="empty">{m.meals.length ? "Nichts offen." : "Noch keine Mahlzeit auswärts."}</div>}
        {open.map((x) => <Row key={x.tx.id} x={x} />)}
      </div>
      {done.length > 0 && <div className="card"><h2>Beglichen</h2>{done.map((x) => <Row key={x.tx.id} x={x} />)}</div>}
    </Stage>
  );
}

/* ---------- Buchung und gleicher Händler ---------- */
function crumbsOf(d: D, base: string[], today: string): Crumb[] {
  const out: Crumb[] = [];
  const b = base[0];
  const at = (k: number) => href(...base.slice(0, k));
  if (b === "analyse") {
    const month = base[1] ?? today.slice(0, 7);
    out.push({ label: monthName(month, today), href: at(2) });
    const wk = /^w([1-5])$/.exec(base[2] ?? "");
    if (wk) out.push({ label: `Woche ${wk[1]}`, href: at(3) });
    const cs = base[wk ? 3 : 2];
    if (cs) out.push({ label: catOf(d.cats, cs)?.name ?? "Ohne Kategorie", href: at(wk ? 4 : 3) });
  } else if (b === "tag") out.push({ label: day(base[1]!), href: at(2) });
  else if (b === "konto") out.push({ label: d.accs.find((a) => a.id === base[1])?.name ?? "Konto", href: at(2) });
  else if (b === "buchungen") out.push({ label: monthName(base[1]!, today), href: at(2) });
  else if (b === "mama") out.push({ label: "Offen von Mama", href: at(1) });
  else out.push({ label: "Geld", href: "/geld" });
  return out;
}

function Buchung({ d, segs, today }: { d: D; segs: string[]; today: string }) {
  const id = segs[segs.length - 1]!;
  const base = segs.slice(0, -2);
  const upd = useUpdateTx();
  const t = d.txs.find((x) => x.id === id);
  const parent = href(...base);
  if (!t) return <Stage title="Buchung" back={parent}><NotFound /></Stage>;
  const m = merchantOf(t.description);
  const same = sameMerchant(d.txs, t);
  const viaMerchant = base.includes("haendler");
  const acc = d.accs.find((a) => a.id === t.accountId);
  const time = t.bookedAt && t.bookedAt.includes("T") ? new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t.bookedAt)) : null;
  const set = (patch: Record<string, unknown>) => upd.mutate({ id, patch });
  const Toggle = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
    <button type="button" className="chip btn press" aria-pressed={on} aria-label={label} onClick={onClick}>{on ? "Ja" : "Nein"}</button>
  );
  return (
    <Stage title="Buchung" back={parent} crumbs={[...crumbsOf(d, segs.slice(0, segs.indexOf("buchung")), today), { label: m.name }]}>
      <div className="center">
        <Money v={t.amount} size={44} signed />
        <span className="lbl" style={{ fontSize: "var(--t-md)", maxWidth: "100%", overflowWrap: "anywhere" }}>{m.name}</span>
      </div>
      <div className="card" style={{ paddingTop: 0 }}>
        <Link href={href("tag", t.date)} className="kv press"><span>Datum</span><span>{day(t.date)}{time ? `, ${time}` : ""}</span></Link>
        {acc && <Link href={href("konto", acc.id)} className="kv press"><span>Konto</span><span>{acc.name}</span></Link>}
        <div className="kv" style={{ alignItems: "center" }}>
          <label htmlFor="tx-c">Kategorie</label>
          <select id="tx-c" className="inp" value={t.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
            <option value="">Keine</option>
            {d.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {t.amount < 0 && <div className="kv" style={{ alignItems: "center" }}><span>Mahlzeit auswärts</span><Toggle on={t.mealOut} label="Mahlzeit auswärts" onClick={() => set({ mealOut: !t.mealOut })} /></div>}
        {t.amount > 0 && <div className="kv" style={{ alignItems: "center" }}><span>Rückzahlung von Mama</span><Toggle on={t.isRepayment} label="Rückzahlung von Mama" onClick={() => set({ isRepayment: !t.isRepayment })} /></div>}
        <div className="kv"><span>Eigene Überweisung</span><span>{t.internal ? "Ja" : "Nein"}</span></div>
        {t.currency !== "CHF" && <div className="kv"><span>Währung</span><span>{t.currency}</span></div>}
        {same.length > 1 && !viaMerchant && (
          <Link href={href(...segs, "haendler")} className="kv press" style={{ alignItems: "center" }}>
            <span>Gleicher Händler</span>
            <span>{same.length} Buchungen · {nf(spendSum(same), 2)} <Icon n="chev" className="go" /></span>
          </Link>
        )}
      </div>
      {t.description && <div className="card"><h2>Originaltext</h2><p className="orig">{t.description}</p></div>}
    </Stage>
  );
}

function Haendler({ d, segs, today }: { d: D; segs: string[]; today: string }) {
  const id = segs[segs.length - 2]!;
  const base = segs.slice(0, -1); // endet auf buchung/<id>
  const t = d.txs.find((x) => x.id === id);
  if (!t) return <Stage title="Händler" back={href(...base)}><NotFound /></Stage>;
  const m = merchantOf(t.description);
  const same = sameMerchant(d.txs, t).sort(newestFirst);
  const out = same.filter((x) => ownShare(x) > 0).length;
  return (
    <Stage title="Händler" back={href(...base)} crumbs={[...crumbsOf(d, segs.slice(0, segs.indexOf("buchung")), today), { label: m.name, href: href(...base) }, { label: "Alle Buchungen" }]}>
      <div className="center">
        <Money v={spendSum(same)} size={44} />
        <span className="lbl">{m.name} · {same.length} {same.length === 1 ? "Buchung" : "Buchungen"}{out !== same.length ? `, ${out} Ausgaben` : ""}</span>
      </div>
      <TxList txs={same} d={d} base={[...segs]} />
    </Stage>
  );
}

/* ---------- Depot ---------- */
function useKurse() {
  return useQuery({ queryKey: ["depot-kurse"], queryFn: () => api.money.depotKurse(), staleTime: 5 * 60_000, retry: 0 });
}

function Depot({ segs }: { segs: string[] }) {
  const dep = useDepot();
  const s = useSettings();
  const sheet = useSheet();
  const kurse = useKurse();
  const holdings = depotHoldings(s) ?? [];
  const series = dep.series;
  if (segs[1] === "stand") {
    const date = segs[2] ?? "";
    const p = series.find((x) => x.date === date);
    return (
      <Stage title={day(date)} back="/geld/depot" crumbs={[{ label: "Portfolio", href: "/geld/depot" }, { label: day(date) }]}>
        {!p ? <NotFound /> : (
          <>
            <div className="center"><Money v={p.value} size={44} /><span className="lbl">{p.estimated ? "geschätzt" : "berechnet oder eingetragen"}</span></div>
            <div className="card" style={{ paddingTop: 0 }}>
              <div className="kv"><span>Einbezahlt</span><span><Money v={p.deposited} size={17} cur={false} /></span></div>
              <div className="kv"><span>Gewinn</span><span className={p.gain === 0 ? "" : p.gain > 0 ? "good" : "bad"}><Money v={p.gain} size={17} cur={false} signed /></span></div>
              {p.deposited > 0 && <div className="kv"><span>Rendite</span><span>{pctText((p.gain / p.deposited) * 100)}</span></div>}
            </div>
          </>
        )}
      </Stage>
    );
  }
  if (segs[1]) {
    const h = holdings.find((x) => x.symbol === segs[1]);
    const prod = portfolioProduct(segs[1]);
    if (!h || !prod) return <Stage title="Position" back="/geld/depot"><NotFound /></Stage>;
    const q = kurse.data?.find((x) => x.symbol === h.symbol);
    const value = q?.close != null && q.fx != null ? h.shares * q.close * q.fx : null;
    return (
      <Stage title={prod.symbol} back="/geld/depot" crumbs={[{ label: "Portfolio", href: "/geld/depot" }, { label: prod.symbol }]}>
        <div className="center">
          {value !== null ? <Money v={value} size={44} /> : <span className="bigv faint" style={{ fontSize: 44 }}>–</span>}
          <span className="lbl">{prod.name}</span>
        </div>
        <div className="card" style={{ paddingTop: 0 }}>
          <div className="kv"><span>Anteile</span><span>{nf(h.shares, 2)}</span></div>
          <div className="kv"><span>Kurs</span><span>{q?.close != null ? `${nf(q.close, 2)} EUR${q.date ? ` · ${day(q.date)}` : ""}` : kurse.isPending ? "…" : "nicht abrufbar"}</span></div>
          {q?.fx != null && <div className="kv"><span>Wechselkurs</span><span>{nf(q.fx, 4)} CHF je EUR</span></div>}
          <div className="kv"><span>Index</span><span>{prod.index}</span></div>
          <div className="kv"><span>ISIN</span><span>{prod.isin}</span></div>
        </div>
        <div className="card"><div className="empty">Ein Kursverlauf je Position wird nicht gespeichert, nur der Gesamtwert. Er steht im Portfolio.</div></div>
      </Stage>
    );
  }
  const latest = dep.latest;
  return (
    <Stage title="Portfolio" back="/geld" crumbs={[{ label: "Portfolio" }]}>
      <div className="center">
        {latest ? <Money v={latest.value} size={44} /> : <span className="bigv faint" style={{ fontSize: 44 }}>–</span>}
        {latest && <span className={latest.gain === 0 ? "muted" : latest.gain > 0 ? "good" : "bad"} style={{ fontWeight: 600 }}><Money v={latest.gain} size={17} cur={false} signed />{dep.pct !== null && <span style={{ marginLeft: 8 }}>{pctText(dep.pct)}</span>}</span>}
        {!latest && <span className="lbl">Startbestand eintragen</span>}
      </div>
      <div className="card">
        <h2>Positionen</h2>
        {holdings.length === 0 && <div className="empty">Noch keine Position.</div>}
        {holdings.map((h) => {
          const q = kurse.data?.find((x) => x.symbol === h.symbol);
          const value = q?.close != null && q.fx != null ? h.shares * q.close * q.fx : null;
          return (
            <Link key={h.symbol} href={`/geld/depot/${h.symbol}`} className="lrow press">
              <span className="ic">{h.symbol.slice(0, 2)}</span>
              <span className="w"><b>{h.symbol}</b><span>{nf(h.shares, 2)} Anteile</span></span>
              <span className="a">{value !== null ? <Money v={value} size={17} cur={false} /> : <span className="faint">–</span>}<Icon n="chev" className="go" /></span>
            </Link>
          );
        })}
      </div>
      {series.length > 0 && (
        <div className="card">
          <h2>Verlauf</h2>
          {[...series].reverse().slice(0, 30).map((p) => (
            <Link key={p.date} href={`/geld/depot/stand/${p.date}`} className="lrow nopic press">
              <span className="w"><b>{day(p.date)}</b><span>{p.estimated ? "geschätzt" : "Stand"}</span></span>
              <span className="a"><Money v={p.value} size={17} cur={false} /><Icon n="chev" className="go" /></span>
            </Link>
          ))}
        </div>
      )}
      <button type="button" className="cta ghost press" style={{ marginTop: 0 }} onClick={() => sheet.open(<DepotSheet />)}>Eintragen</button>
    </Stage>
  );
}
