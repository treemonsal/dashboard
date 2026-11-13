import { describe, expect, it } from "vitest";
import { CAT, DEFAULT_RULES, applyCategories, categorize, learnRule, markInternalTransfers, mealShares, monthSummary, type Buchung } from "../../src/shared/bank";

let seq = 0;
function b(date: string, description: string, amount: number, extra: Partial<Buchung> = {}): Buchung {
  return { date, description, amount, currency: "CHF", amountChf: amount, raw: {}, hash: `h${seq++}`, account: "A", ...extra };
}

describe("categorize", () => {
  it.each([
    ["MIGROS Zürich HB", CAT.food],
    ["Coop Pronto 123", CAT.food],
    ["SBB Mobile", CAT.transport],
    ["Uber *Trip", CAT.transport],
    ["Uber Eats Bestellung", CAT.dining],
    ["Burger King Basel", CAT.dining],
    ["DEAN & DAVID Zürich", CAT.dining],
    ["Apple.com/bill", CAT.fun],
    ["Steam Purchase", CAT.fun],
    ["Einzahlung Säule 3a", CAT.invest],
    ["Lohn Oktober", CAT.income],
    ["Sparkasse Gebühr", CAT.other],
    ["Kartierung Tierpark", CAT.other],
    ["Belohnung", CAT.other],
  ])("%s", (text, cat) => expect(categorize({ description: text }).category).toBe(cat));
  it("Nutzerregeln vor Standardregeln", () => {
    const rules = [{ pattern: "migros bank", category: "Bank" }, ...DEFAULT_RULES];
    expect(categorize({ description: "Migros Bank Gebühr" }, rules).category).toBe("Bank");
  });
  it("applyCategories lässt manuelle Werte stehen", () => {
    const out = applyCategories([b("2026-03-01", "Migros", -500, { category: "Eigene" })]);
    expect(out[0]!.category).toBe("Eigene");
  });
});

describe("learnRule", () => {
  it.each([
    ["Kartenzahlung Migros Filiale 0123 Zürich 5678", "migros"],
    ["Kauf/Dienstleistung vom 12.03.2026 Tibits Zürich HB Karte xxxx 1234", "tibits"],
    ["BURGER KING BASEL SBB, CH", "burger king"],
    ["Zahlung Dean & David Bahnhofstrasse 1", "dean & david"],
    ["Subway 4711 Bern", "subway"],
    ["Coop Pronto ZH", "coop pronto"],
  ])("%s", (desc, pattern) => {
    const rule = learnRule(desc, "X")!;
    expect(rule.pattern).toBe(pattern);
    expect(categorize({ description: desc }, [rule]).category).toBe("X");
  });
  it("keine Regel ohne erkennbaren Händler", () => expect(learnRule("12345 678", "X")).toBeNull());
});

describe("interne Überweisungen", () => {
  it("paart gleiche Beträge mit umgekehrtem Vorzeichen in verschiedenen Konten innerhalb von 3 Tagen", () => {
    const rows = [
      b("2026-03-01", "An Revolut", -35000, { account: "ZKB" }),
      b("2026-03-03", "Von ZKB", 35000, { account: "REV" }),
      b("2026-03-01", "Kaffee", -450, { account: "ZKB" }),
    ];
    const out = markInternalTransfers(rows);
    expect(out.map((r) => !!r.internal)).toEqual([true, true, false]);
    expect(rows[0]!.internal).toBeUndefined();
  });
  it("nicht bei 4 Tagen, gleichem Konto oder gleichem Vorzeichen", () => {
    expect(markInternalTransfers([b("2026-03-01", "a", -100, { account: "X" }), b("2026-03-05", "b", 100, { account: "Y" })]).some((r) => r.internal)).toBe(false);
    expect(markInternalTransfers([b("2026-03-01", "a", -100, { account: "X" }), b("2026-03-01", "b", 100, { account: "X" })]).some((r) => r.internal)).toBe(false);
    expect(markInternalTransfers([b("2026-03-01", "a", -100, { account: "X" }), b("2026-03-01", "b", -100, { account: "Y" })]).some((r) => r.internal)).toBe(false);
  });
  it("jede Buchung nur in einem Paar, nächstes Datum gewinnt", () => {
    const rows = [
      b("2026-03-01", "aus", -100, { account: "X" }),
      b("2026-03-03", "ein fern", 100, { account: "Y" }),
      b("2026-03-01", "ein nah", 100, { account: "Y" }),
    ];
    expect(markInternalTransfers(rows).map((r) => !!r.internal)).toEqual([true, false, true]);
  });
});

describe("Mahlzeiten", () => {
  const settings = { payerName: "Muster", minMealRappen: 1000 };
  const dining = (date: string, amount: number, extra: Partial<Buchung> = {}) => b(date, "Restaurant Test", amount, { category: CAT.dining, ...extra });
  const twint = (date: string, amount: number) => b(date, "TWINT Gutschrift Muster Mutter", amount);

  it("Mahlzeit gegen Snack nach Schwelle, Übersteuerung über isMeal", () => {
    const res = mealShares([dining("2026-03-01", -1500), dining("2026-03-01", -999), dining("2026-03-02", -999, { isMeal: true }), dining("2026-03-02", -3000, { isMeal: false })], settings);
    expect(res.meals.map((m) => m.row.amount)).toEqual([-1500, -999]);
  });
  it("Anteil 50 Prozent kaufmännisch gerundet", () => {
    expect(mealShares([dining("2026-03-01", -1005)], settings).meals[0]!.expected).toBe(503);
    expect(mealShares([dining("2026-03-01", -1001)], settings).meals[0]!.expected).toBe(501);
  });
  it("voll beglichen, Eingang zählt nicht als Einkommen", () => {
    const rep = twint("2026-03-02", 750);
    const rows = [dining("2026-03-01", -1500), rep];
    const res = mealShares(rows, settings);
    expect(res.openRappen).toBe(0);
    expect(res.settled).toHaveLength(1);
    expect(res.repaymentRows.has(rep)).toBe(true);
    expect(monthSummary(rows, "2026-03", 30000, settings).income).toBe(0);
  });
  it("Teilrückzahlung geht an die älteste offene Mahlzeit, Rest bleibt offen", () => {
    const res = mealShares([dining("2026-03-01", -2000), dining("2026-03-05", -1600), twint("2026-03-06", 1200)], settings);
    expect(res.meals.map((m) => [m.expected, m.received, m.open])).toEqual([[1000, 1000, 0], [800, 200, 600]]);
    expect(res.openRappen).toBe(600);
    expect(res.unmatchedIncoming).toEqual([]);
  });
  it("Überzahlung und Eingang ohne Mahlzeit sind nicht zuordenbar", () => {
    const rows = [dining("2026-03-10", -1000), twint("2026-03-11", 800), twint("2026-03-01", 500)];
    const res = mealShares(rows, settings);
    expect(res.openRappen).toBe(0);
    expect(res.unmatchedIncoming.map((u) => u.rappen).sort()).toEqual([300, 500]);
  });
  it("Name in anderer Schreibweise, ohne payerName keine Zuordnung", () => {
    const rows = [dining("2026-03-01", -1000), b("2026-03-02", "TWINT M. Muster", 500)];
    expect(mealShares(rows, { payerName: "Maria Muster" }).openRappen).toBe(0);
    expect(mealShares(rows, {}).openRappen).toBe(500);
  });
});

describe("monthSummary", () => {
  const rows = [
    b("2026-02-28", "Vormonat", -9999, { category: CAT.food }),
    b("2026-03-01", "Migros", -1000, { category: CAT.food }),
    b("2026-03-01", "Coop", -500, { category: CAT.food }),
    b("2026-03-02", "Restaurant", -2000, { category: CAT.dining }),
    b("2026-03-02", "TWINT Muster", 1000),
    b("2026-03-03", "Lohn", 65000, { category: CAT.income }),
    b("2026-03-03", "Depot", -35000, { category: CAT.invest }),
    b("2026-03-04", "Umbuchung", -7000, { internal: true }),
    b("2026-03-04", "Umbuchung", 7000, { internal: true, account: "B" }),
    b("2026-03-05", "Kino", -1500, { category: CAT.fun }),
    b("2026-04-01", "Nächster Monat", -4200, { category: CAT.food }),
  ];
  const mar = monthSummary(rows, "2026-03", 30000, { payerName: "Muster", today: "2026-03-05" });
  it("eigener Anteil ohne interne Überweisungen und Anlage, Mahlzeit halb", () => {
    expect(mar.spent).toBe(1000 + 500 + 1000 + 1500);
    expect(mar.left).toBe(30000 - 4000);
    expect(mar.income).toBe(65000);
  });
  it("nach Kategorie mit Anzahl und Anteil", () => {
    expect(mar.byCategory[0]).toMatchObject({ category: CAT.food, count: 2, amount: 1500 });
    expect(mar.byCategory[0]!.share).toBeCloseTo(0.375);
    expect(mar.byCategory.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
  });
  it("kumuliert pro Tag und linear hochgerechnet", () => {
    expect(mar.daily.map((d) => d.cumulative)).toEqual([1500, 2500, 2500, 2500, 4000]);
    expect(mar.daysElapsed).toBe(5);
    expect(mar.projected).toBe(Math.round((4000 / 5) * 31));
    expect(mar.projectedLeft).toBe(30000 - mar.projected);
  });
  it("Monatswechsel: abgeschlossener Monat wird nicht hochgerechnet, Folgemonat zählt nicht mit", () => {
    const feb = monthSummary(rows, "2026-02", 30000);
    expect(feb.spent).toBe(9999);
    expect(feb.daysElapsed).toBe(28);
    expect(feb.projected).toBe(9999);
    const apr = monthSummary(rows, "2026-04", 30000);
    expect(apr.spent).toBe(4200);
    expect(apr.daysElapsed).toBe(1);
  });
  it("leerer Monat", () => {
    const s = monthSummary([], "2026-03", 30000);
    expect(s).toMatchObject({ spent: 0, left: 30000, projected: 0, byCategory: [] });
  });
});
