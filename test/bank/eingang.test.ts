import { describe, expect, it } from "vitest";
import { cleanMerchant, dedupeKey, parseBetrag } from "../../src/shared/bank";

describe("parseBetrag", () => {
  it.each([
    ["CHF 12.50", 1250, "CHF"],
    ["12,50 CHF", 1250, "CHF"],
    ["Fr. 12.50", 1250, "CHF"],
    ["Fr 12.50", 1250, "CHF"],
    ["12.50 Fr.", 1250, "CHF"],
    ["SFr. 7", 700, "CHF"],
    ["chf12.5", 1250, "CHF"],
    ["CHF 1'234.50", 123450, "CHF"],
    ["€ 3,20", 320, "EUR"],
    ["3.20 EUR", 320, "EUR"],
    ["$5", 500, "USD"],
    ["12.50", 1250, null],
    ["12,5", 1250, null],
    ["0.05", 5, null],
    ["  12.50  ", 1250, null],
    ["12.50 CHF", 1250, "CHF"],
  ])("%s", (input, rappen, currency) => expect(parseBetrag(input)).toEqual({ rappen, currency }));

  it("Zahlen", () => {
    expect(parseBetrag(12.5)).toEqual({ rappen: 1250, currency: null });
    expect(parseBetrag(0.1 + 0.2)).toEqual({ rappen: 30, currency: null });
    expect(parseBetrag(4999.99)).toEqual({ rappen: 499999, currency: null });
  });

  it("Vorzeichen bleibt erhalten (die Route lehnt es ab)", () => {
    expect(parseBetrag("-12.50")?.rappen).toBe(-1250);
  });

  it.each(["", "   ", "abc", "CHF", "CHF CHF 5", "CHF 5 EUR", "12.5.5.5", "1e5", "12.50 Franken", "Fr. Fr. 3", "NaN", "Infinity", "12 50x", "0x10", "--5", "12.50;DROP", "x".repeat(60)])("lehnt ab: %j", (s) => {
    expect(parseBetrag(s)).toBeNull();
  });

  it("lehnt Nicht-Zahlen ab", () => {
    for (const v of [NaN, Infinity, null, undefined, {}, [], true, 1e12]) expect(parseBetrag(v)).toBeNull();
  });
});

describe("cleanMerchant und dedupeKey", () => {
  it("entfernt Steuerzeichen und Umbrüche", () => {
    expect(cleanMerchant("  Migros\n\tZürich\u0000 ‮HB ")).toBe("Migros Zürich HB");
  });
  it("Doppel-Schlüssel ignoriert Gross/Klein und Leerraum, nicht Betrag, Konto oder Währung", () => {
    const base = { merchant: "Migros  Zürich", rappen: 500, currency: "CHF", account: "a" };
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base, merchant: "MIGROS zürich" }));
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, rappen: 501 }));
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, account: "b" }));
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, currency: "EUR" }));
  });
});
