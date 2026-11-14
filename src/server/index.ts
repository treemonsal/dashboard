import { runScheduled } from "./cron";
import type { McpEnv } from "./mcp/env";
import { createWorker } from "./mcp/worker";

// Die App (src/server/app.ts) läuft hinter dem OAuth-Provider des MCP-Connectors; siehe docs/connector.md.
const worker = createWorker();

export default {
  fetch: (req: Request, env: McpEnv, ctx: ExecutionContext) => worker.fetch(req, env, ctx),
  // Cron (wrangler.jsonc triggers.crons): Erinnerungen und Kalender-Abgleich, siehe src/server/cron.ts.
  scheduled: (_c: ScheduledController, env: McpEnv, ctx: ExecutionContext) => ctx.waitUntil(runScheduled(env)),
} satisfies ExportedHandler<McpEnv>;
