import { describe, expect, it } from "vitest";
import { reconcile, type Auszugszeile, type Vorlaeufig } from "../../src/shared/bank";

const p = (id: string, date: string, amount: number, description: string, extra: Partial<Vorlaeufig> = {}): Vorlaeufig => ({ id, account: "rev", date, amount, currency: "CHF", description, ...extra });
const r = (date: string, description: string, amount: number, extra: Partial<Auszugszeile> = {}): Auszugszeile => ({ date, description, amount, currency: "CHF", amountChf: amount, ...extra });
const opts = { account: "rev" };

describe("reconcile", () => {
  it("ordnet bei gleichem Betrag und Datum innerhalb von 3 Tagen zu", () => {
    const res = reconcile([p("a", "2026-10-10", -1250, "Migros")], [r("2026-10-12", "Kartenzahlung Migros Zürich", -1250)], opts);
    expect(res.matches).toEqual([{ provisionalId: "a", rowIndex: 0, similarity: 1, days: 2 }]);
    expect(res.missing).toEqual([]);
  });

  it("4 Tage Abstand ist kein Treffer", () => {
    const res = reconcile([p("a", "2026-10-10", -1250, "Migros")], [r("2026-10-01", "Coop", -300), r("2026-10-14", "Migros", -1250), r("2026-10-20", "Coop", -300)], opts);
    expect(res.matches).toEqual([]);
    expect(res.missing).toEqual(["a"]);
  });

  it("Trinkgeld-Abweichung gilt nicht als Treffer", () => {
    const res = reconcile([p("a", "2026-10-10", -1250, "Restaurant Sonne")], [r("2026-10-10", "Restaurant Sonne", -1400)], opts);
    expect(res.matches).toEqual([]);
    expect(res.missing).toEqual(["a"]);
  });

  it("jede Zeile nur einmal: zwei gleiche Vorläufige, eine Zeile", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "Kiosk"), p("b", "2026-10-10", -500, "Kiosk")], [r("2026-10-10", "Kiosk", -500), r("2026-10-31", "Lohn", 65000)], opts);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]!.provisionalId).toBe("a");
    expect(res.missing).toEqual(["b"]);
  });

  it("gleiche Beträge am selben Tag: der ähnlichere Name gewinnt, nicht die Reihenfolge", () => {
    const res = reconcile(
      [p("kaffee", "2026-10-10", -450, "Starbucks"), p("bahn", "2026-10-10", -450, "SBB")],
      [r("2026-10-10", "SBB Mobile Ticket", -450), r("2026-10-10", "Starbucks Zürich HB", -450)],
      opts,
    );
    const byId = Object.fromEntries(res.matches.map((m) => [m.provisionalId, m.rowIndex]));
    expect(byId).toEqual({ kaffee: 1, bahn: 0 });
  });

  it("bei gleichem Namen gewinnt der kleinere Datumsabstand", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "Migros")], [r("2026-10-13", "Migros", -500), r("2026-10-11", "Migros", -500)], opts);
    expect(res.matches[0]!.rowIndex).toBe(1);
  });

  it("zwei Vorläufige, zwei Zeilen mit demselben Text: je eine Zuordnung, nichts doppelt", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "Migros"), p("b", "2026-10-11", -500, "Migros")], [r("2026-10-10", "Migros", -500), r("2026-10-11", "Migros", -500)], opts);
    expect(res.matches.map((m) => [m.provisionalId, m.rowIndex]).sort()).toEqual([["a", 0], ["b", 1]]);
  });

  it("Fremdwährung: gleicher Originalbetrag in gleicher Währung trifft, CHF-Umrechnung allein nicht", () => {
    const eur = p("e", "2026-10-10", -1000, "Bar Roma", { currency: "EUR" });
    const hit = reconcile([eur], [r("2026-10-11", "Bar Roma", -1000, { currency: "EUR", amountChf: -950 })], opts);
    expect(hit.matches).toHaveLength(1);
    const miss = reconcile([eur], [r("2026-10-11", "Bar Roma", -950)], opts);
    expect(miss.matches).toHaveLength(0);
    // gleicher Zahlenwert, aber andere Währung
    const other = reconcile([eur], [r("2026-10-10", "Bar Roma", -1000)], opts);
    expect(other.matches).toHaveLength(0);
  });

  it("Vorzeichen zählt: eine Einnahme trifft keine Ausgabe", () => {
    expect(reconcile([p("a", "2026-10-10", -500, "X")], [r("2026-10-10", "X", 500)], opts).matches).toEqual([]);
  });

  it("andere Konten bleiben unberührt", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "Migros", { account: "zkb" })], [r("2026-10-10", "Migros", -500)], opts);
    expect(res.matches).toEqual([]);
    expect(res.missing).toEqual([]);
    expect(res.untouched).toEqual(["a"]);
  });

  it("ausserhalb des Zeitraums des Auszugs bleibt unverändert, innerhalb ohne Treffer fehlt im Auszug", () => {
    const rows = [r("2026-10-01", "A", -100), r("2026-10-31", "B", -200)];
    const res = reconcile([p("alt", "2026-09-20", -700, "Z"), p("mitte", "2026-10-15", -700, "Z"), p("neu", "2026-11-05", -700, "Z")], rows, opts);
    expect(res.missing).toEqual(["mitte"]);
    expect(res.untouched.sort()).toEqual(["alt", "neu"]);
  });

  it("leerer Auszug ändert nichts", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "X")], [], opts);
    expect(res).toEqual({ matches: [], missing: [], untouched: ["a"] });
  });

  it("Name ist nur Entscheidungshilfe: ohne Ähnlichkeit gilt trotzdem der einzige Kandidat", () => {
    const res = reconcile([p("a", "2026-10-10", -500, "Kiosk")], [r("2026-10-10", "Zahlung 7731", -500)], opts);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]!.similarity).toBe(0);
  });
});
