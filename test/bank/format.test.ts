import { describe, expect, it } from "vitest";
import { parseAmount, parseDate } from "../../src/shared/bank/num";
import { parseDelimited, readCsv } from "../../src/shared/bank/csv";

describe("parseAmount", () => {
  it.each([
    ["1'234.50", 123450],
    ["1’234.50", 123450],
    ["1.234,50", 123450],
    ["1,234.50", 123450],
    ["1234.5", 123450],
    ["-12,30", -1230],
    ["-12.30", -1230],
    ["12.30-", -1230],
    ["(12.30)", -1230],
    ["CHF 12.30", 1230],
    ["+0.05", 5],
    ["1 234,5", 123450],
    ["−12,30", -1230],
    ["1,234", 123400],
    ["12,5", 1250],
    ["7", 700],
    ["1'234'567.89", 123456789],
    ["0.29", 29],
  ])("%s", (input, rappen) => expect(parseAmount(input)).toBe(rappen));
  it.each(["", "-", "abc", "12.3x4.5.", "1.2.3,4,5"])("lehnt %j ab", (s) => expect(parseAmount(s)).toBeNull());
});

describe("parseDate", () => {
  it.each([
    ["13.11.2026", "2026-11-13", undefined],
    ["3.1.2026", "2026-01-03", undefined],
    ["2026-11-13", "2026-11-13", undefined],
    ["13/11/2026", "2026-11-13", undefined],
    ["13.11.26", "2026-11-13", undefined],
    ["13.11.2026 09:05", "2026-11-13", "09:05"],
    ["2026-11-13 09:05:59", "2026-11-13", "09:05:59"],
    ["2026-11-13T09:05:59Z", "2026-11-13", "09:05:59"],
    ["13/11/2026, 18:30", "2026-11-13", "18:30"],
  ])("%s", (input, date, time) => {
    const d = parseDate(input)!;
    expect(d.date).toBe(date);
    expect(d.time).toBe(time);
  });
  it.each(["31.02.2026", "2026-13-01", "hallo", "13.11.2026 25:00", ""])("lehnt %j ab", (s) => expect(parseDate(s)).toBeNull());
});

describe("CSV", () => {
  it("Anführungszeichen, doppelte Anführungszeichen, Trennzeichen und Zeilenumbruch in Zellen", () => {
    expect(parseDelimited('a;"b;c";"d ""x"" e";"zwei\nZeilen"\r\n1;2;3;4\r\n', ";")).toEqual([
      ["a", "b;c", 'd "x" e', "zwei\nZeilen"],
      ["1", "2", "3", "4"],
    ]);
  });
  it.each([
    [";", "a;b;c\n1;2,5;3\n4;5,5;6\n"],
    [",", "a,b,c\n1,2.5,3\n4,5.5,6\n"],
    ["\t", "a\tb\tc\n1\t2,5\t3\n4\t5,5\t6\n"],
  ])("erkennt Trennzeichen %j", (d, text) => expect(readCsv(text).delimiter).toBe(d));
  it("BOM und CRLF", () => {
    const { table } = readCsv("﻿a;b\r\n1;2\r\n");
    expect(table).toEqual([["a", "b"], ["1", "2"]]);
  });
});
