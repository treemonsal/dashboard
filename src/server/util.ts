import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import type * as schema from "./db/schema";
import type { AuthEnv } from "./auth";
import { id as idSchema } from "../shared/schemas";

export interface Bindings extends AuthEnv {
  DB: D1Database;
  ASSETS?: Fetcher;
  STATIC?: KVNamespace;
}

export type Db = DrizzleD1Database<typeof schema>;
export type AppEnv = { Bindings: Bindings; Variables: { db: Db; email: string } };

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** Validierung mit einheitlicher Fehlerantwort. */
export function v<T extends z.ZodType, K extends "json" | "query" | "param">(target: K, s: T) {
  return zValidator(target, s, (r, c) => {
    if (!r.success) return c.json({ error: "Ungültige Eingabe", issues: r.error.issues }, 400);
  });
}
export const idParam = z.object({ id: idSchema });

export function notFound(c: Context) {
  return c.json({ error: "Nicht gefunden" }, 404);
}

/** D1-Batch ohne Typgymnastik: erwartet mindestens eine Anweisung. */
export function batch(db: Db, stmts: unknown[]) {
  return stmts.length ? db.batch(stmts as never) : Promise.resolve([]);
}
