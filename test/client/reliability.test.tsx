import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { useDay } from "../../src/client/day";
import { useLatest, useMonthMoney } from "../../src/client/lib";
import { Plaene, Analyse } from "../../src/client/pages-rest";
import { Heute } from "../../src/client/pages-heute";
import { HealthSheet, GeldSheet } from "../../src/client/sheets2";
import { keys } from "../../src/client/queries";
import { addDays, todayInZone } from "../../src/shared/dates";

const today = todayInZone();
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity, gcTime: Infinity } } });
function render(qc: QueryClient, element: ReactElement) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, element));
}
function read<T>(qc: QueryClient, hook: () => T): T {
  let result: T;
  function Probe() { result = hook(); return null; }
  render(qc, createElement(Probe));
  return result!;
}
async function fail(qc: QueryClient, key: readonly unknown[]) {
  await qc.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("Verbindung unterbrochen")) }).catch(() => {});
}

describe("client read reliability", () => {
  it("does not advertise empty training plans or missing exports before reads complete", () => {
    expect(render(client(), createElement(Plaene))).not.toContain("Noch kein Trainingsplan");
    expect(render(client(), createElement(Analyse))).not.toContain("Noch kein Export hochgeladen");
  });
  it("does not calculate a balance from fallback settings before the budget loads", () => {
    const qc = client(); qc.setQueryData(keys.tx(today.slice(0, 7)), []);
    expect(read(qc, useMonthMoney).loaded).toBe(false);
  });
  it("waits for training before claiming the day is empty", () => {
    const qc = client(); qc.setQueryData(keys.tasks, []);
    expect(read(qc, useDay).loading).toBe(true);
    expect(render(qc, createElement(Heute))).not.toContain("Nichts geplant");
  });
  it("exposes a failed day read instead of claiming nothing is planned", async () => {
    const qc = client(); qc.setQueryData(keys.gymDay(today), { plan: null, session: null });
    await fail(qc, keys.tasks);
    expect(read(qc, useDay).error).toBeInstanceOf(Error);
    expect(render(qc, createElement(Heute))).not.toContain("Nichts geplant");
  });
  it("keeps the year card after the money tiles and moves the day before them", () => {
    const qc = client(); qc.setQueryData(keys.tasks, []); qc.setQueryData(keys.gymDay(today), { plan: null, session: null });
    const html = render(qc, createElement(Heute));
    expect(html.indexOf("Dein Tag")).toBeLessThan(html.indexOf('class="tiles"'));
    expect(html.indexOf('class="tiles"')).toBeLessThan(html.indexOf('aria-label="Zeit öffnen"'));
  });
  it("never presents yesterday's steps as today's steps while retaining dated sleep", () => {
    const qc = client();
    const row = { day: addDays(today, -1), steps: 8234, sleepMin: 440, restingHr: null, weightKg: null, source: "fitbit", updatedAt: "" };
    qc.setQueryData(keys.health(addDays(today, -89), today), [row]);
    expect(read(qc, () => useLatest("steps")).latest).toBeNull();
    expect(read(qc, () => useLatest("sleepMin")).latest?.day).toBe(row.day);
    expect(render(qc, createElement(Heute))).toContain(row.day.slice(8, 10) + ".");
  });
  it("does not claim Fitbit is unconnected after a failed health read", async () => {
    const qc = client(); await fail(qc, keys.health(addDays(today, -6), today));
    const html = render(qc, createElement(HealthSheet, { metric: "sleep" }));
    expect(html).not.toContain("Noch nicht mit Fitbit verbunden");
    expect(html).toContain("Verbindung unterbrochen");
  });
  it("does not claim an export is missing while money is loading", () => {
    const html = render(client(), createElement(GeldSheet));
    expect(html).not.toContain("Noch kein Export hochgeladen");
    expect(html).toContain("geladen");
  });
});
