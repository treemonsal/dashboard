import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import type { Account, Category, ImportPreview, ImportResult, Transaction } from "../src/shared/schemas";

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await exports.default.fetch("http://localhost" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}

const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-02 12:30:00,2026-11-02 12:30:00,Pizzeria Roma,-24.00,0.00,CHF,COMPLETED,
CARD_PAYMENT,Current,2026-11-03 10:00:00,2026-11-03 10:00:00,Testkiosk Hauptbahnhof,-4.50,0.00,CHF,COMPLETED,
TOPUP,Current,2026-11-04 09:00:00,2026-11-04 09:00:00,Aufladung,100.00,0.00,CHF,COMPLETED,
TRANSFER,Current,2026-11-05 09:00:00,2026-11-05 09:00:00,Twint Anna Mueller,12.00,0.00,CHF,COMPLETED,
`;
const ZKB = `Kontoauszug;Testkonto
IBAN;CH00 0000 0000 0000 0000 0
Zeitraum;01.11.2026 - 30.11.2026
sep=;

Datum;Buchungstext;Belastung CHF;Gutschrift CHF;Valuta;Saldo CHF
04.11.2026;Überweisung Revolut;100.00;;04.11.2026;900.00
`;
const UNSURE = `Foo;Bar;Baz
1;2;3
4;5;6
`;

describe("Bank-Import", () => {
  it("zeigt eine Vorschau, speichert, überspringt Doppelte und leitet Paare und Rückzahlungen ab", async () => {
    await call("PUT", "/api/settings", { mamaName: "Anna Mueller" });
    const files = [{ name: "revolut.csv", text: REVOLUT }, { name: "zkb-export.csv", text: ZKB }];
    const pre = await call<ImportPreview>("POST", "/api/import/preview", { files });
    expect(pre.status).toBe(200);
    expect(pre.data.fresh).toBe(5);
    expect(pre.data.duplicates).toBe(0);
    expect((await call<Transaction[]>("GET", "/api/transactions?month=2026-11")).data).toHaveLength(0); // Vorschau speichert nichts

    const res = await call<ImportResult>("POST", "/api/import/commit", { files });
    expect(res.status).toBe(201);
    expect(res.data.inserted).toBe(5);
    const again = await call<ImportResult>("POST", "/api/import/commit", { files });
    expect(again.data.inserted).toBe(0);
    expect(again.data.duplicates).toBe(5);

    const accs = await call<Account[]>("GET", "/api/accounts");
    expect(accs.data.some((a) => a.name === "ZKB")).toBe(true);
    const tx = (await call<Transaction[]>("GET", "/api/transactions?month=2026-11")).data;
    expect(tx).toHaveLength(5);
    const pizza = tx.find((x) => x.description === "Pizzeria Roma")!;
    expect(pizza.amount).toBe(-24);
    expect(pizza.mealOut).toBe(true); // Gastronomie ab 10 Franken
    expect(tx.find((x) => x.description === "Testkiosk Hauptbahnhof")!.mealOut).toBe(false);
    // Aufladung (Revolut +100) und Überweisung (ZKB -100) sind ein Paar: keine Ausgabe, kein Einkommen
    expect(tx.filter((x) => x.internal)).toHaveLength(2);
    expect(tx.find((x) => x.description?.includes("Twint Anna"))!.isRepayment).toBe(true);

    // Korrektur einer Kategorie lernt eine Regel

    await call("POST", "/api/categories", { name: "Unterhaltung" });
    const cats = (await call<Category[]>("GET", "/api/categories")).data;
    const fun = cats.find((c) => c.name === "Unterhaltung")!;
        const kiosk = tx.find((x) => x.description === "Testkiosk Hauptbahnhof")!;
    const r = await call<Transaction>("PATCH", `/api/transactions/${kiosk.id}`, { categoryId: fun.id });
    expect(r.data.categoryId).toBe(fun.id);
    const rules = (await call<{ pattern: string; category: string }[]>("GET", "/api/category-rules")).data;
    expect(rules.some((x) => x.category === "Unterhaltung")).toBe(true);
    // Nächster Import: gleicher Händler landet in der gelernten Kategorie
    const next = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-09 10:00:00,2026-11-09 10:00:00,Testkiosk Hauptbahnhof,-3.20,0.00,CHF,COMPLETED,
`;
    const pre2 = await call<ImportPreview>("POST", "/api/import/preview", { files: [{ name: "revolut2.csv", text: next }] });
    expect(pre2.data.files[0].sample[0].category).toBe("Unterhaltung");
    });

  it("verlangt bei unsicheren Spalten eine Bestätigung und liest dann mit der Zuordnung", async () => {
    const pre = await call<ImportPreview>("POST", "/api/import/preview", { files: [{ name: "x.csv", text: UNSURE }] });
    expect(pre.data.files[0].needsConfirmation).toBe(true);
    expect(pre.data.files[0].mapping).not.toBeNull();
    const bad = await call("POST", "/api/import/preview", { files: [] });
    expect(bad.status).toBe(400);
  });

});
