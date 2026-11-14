import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/server/db/schema";
import { createApp } from "../src/server/app";
import { addDays, todayInZone } from "../src/shared/dates";

const db = drizzle(env.DB, { schema });
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch("http://localhost/api" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() as any };
}

describe("Task integrity", () => {
  it("undo preserves edited and unrelated matching tasks", async () => {
    const dueDate = addDays(todayInZone(), 3);
    const original = (await call("POST", "/tasks", { title: "Integrity recurrence", dueDate, recurrence: "FREQ=DAILY" })).data;
    await call("PATCH", `/tasks/${original.id}`, { done: true });
    const followup = (await call("GET", "/tasks")).data.find((t: any) => t.title === original.title && !t.doneAt);
    await call("PATCH", `/tasks/${followup.id}`, { notes: "Keep my edit" });
    const unrelated = (await call("POST", "/tasks", { title: original.title, dueDate: followup.dueDate, recurrence: original.recurrence })).data;
    await call("PATCH", `/tasks/${original.id}`, { done: false });
    expect((await call("GET", `/tasks/${followup.id}`)).data.notes).toBe("Keep my edit");
    expect((await call("GET", `/tasks/${unrelated.id}`)).status).toBe(200);
    await call("PATCH", `/tasks/${original.id}`, { done: true });
    const open = (await call("GET", "/tasks")).data.filter((t: any) => t.title === original.title && !t.doneAt);
    expect(open).toHaveLength(2);
  });
  it("undo does not cascade into newly added subtasks", async () => {
    const original = (await call("POST", "/tasks", { title: "Integrity parent", recurrence: "FREQ=DAILY" })).data;
    await call("PATCH", `/tasks/${original.id}`, { done: true });
    const followup = (await call("GET", "/tasks")).data.find((t: any) => t.title === original.title && !t.doneAt);
    const child = (await call("POST", "/tasks", { title: "Keep child", parentId: followup.id })).data;
    await call("PATCH", `/tasks/${original.id}`, { done: false });
    expect((await call("GET", `/tasks/${child.id}`)).status).toBe(200);
  });
  it("PATCH returns the same camelCase task contract as GET", async () => {
    const task = (await call("POST", "/tasks", { title: "Integrity response", dueDate: "2027-01-01", dueTime: "08:00" })).data;
    const patched = await call("PATCH", `/tasks/${task.id}`, { notes: "changed" });
    expect(patched.data).toMatchObject({ dueDate: "2027-01-01", dueTime: "08:00", doneAt: null });
  });
  it("rolls completion back when an event insert fails", async () => {
    const task = (await call("POST", "/tasks", { title: "Integrity rollback", recurrence: "FREQ=DAILY" })).data;
    await env.DB.exec("CREATE TRIGGER reject_integrity_event BEFORE INSERT ON task_events WHEN NEW.title = 'Integrity rollback' BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed'); END");
    try {
      expect((await call("PATCH", `/tasks/${task.id}`, { done: true })).status).toBe(400);
      expect((await call("GET", `/tasks/${task.id}`)).data.doneAt).toBeNull();
    } finally { await env.DB.exec("DROP TRIGGER reject_integrity_event"); }
  });
});

it("manual repayment false survives imports and null restores automatic detection", async () => {
  await call("PUT", "/settings", { mamaName: "Integrity Payer" });
  const files = [{ name: "revolut.csv", text: "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nTRANSFER,Current,2026-11-07 09:00:00,2026-11-07 09:00:00,Twint Integrity Payer,12.00,0.00,CHF,COMPLETED,\n" }];
  await call("POST", "/import/commit", { files });
  const tx = (await call("GET", "/transactions?month=2026-11")).data.find((x: any) => x.description === "Twint Integrity Payer");
  expect(tx.isRepayment).toBe(true);
  expect((await call("PATCH", `/transactions/${tx.id}`, { isRepayment: false })).data.isRepayment).toBe(false);
  await call("POST", "/import/commit", { files });
  expect((await call("GET", "/transactions?month=2026-11")).data.find((x: any) => x.id === tx.id).isRepayment).toBe(false);
  expect((await call("PATCH", `/transactions/${tx.id}`, { repaymentOverride: null })).data.isRepayment).toBe(true);
});

it("exports workouts and calendar metadata/events without credential secrets", async () => {
  await db.insert(schema.calendars).values({ id: "export-calendar", name: "Export calendar", url: "https://secret.example/calendar-token" });
  await db.insert(schema.calendarEvents).values({ id: "export-event", calendarId: "export-calendar", uid: "uid-export", title: "Export event", startDate: "2026-11-14", endDate: "2026-11-14" });
  await db.insert(schema.healthWorkouts).values({ id: "export-workout", day: "2026-11-14", startAt: "2026-11-14T08:00:00Z", type: "run" });
  await db.insert(schema.healthConnection).values({ id: "export-provider", refreshEnc: "secret-refresh", accessEnc: "secret-access" });
  await db.insert(schema.healthCredentials).values({ id: "export-provider", clientIdEnc: "secret-client", clientSecretEnc: "secret-client-secret", idTail: "tail" });
  const result = (await call("GET", "/export")).data;
  expect(result.schemaVersion).toBe(2);
  expect(result.healthWorkouts).toEqual(expect.arrayContaining([expect.objectContaining({ id: "export-workout" })]));
  expect(result.calendars).toEqual(expect.arrayContaining([expect.objectContaining({ id: "export-calendar", name: "Export calendar" })]));
  expect(result.calendarEvents).toEqual(expect.arrayContaining([expect.objectContaining({ id: "export-event" })]));
  expect(JSON.stringify(result)).not.toMatch(/secret\.example|calendar-token|secret-refresh|secret-access|secret-client/);
});

it("serves the PDF mjs worker with a JavaScript MIME type", async () => {
  const app = createApp();
  const response = await app.fetch(new Request("http://localhost/assets/pdf.worker.mjs"), { ...env, ASSETS: undefined, STATIC: { get: async () => new TextEncoder().encode("export {};").buffer } as unknown as KVNamespace });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
});
