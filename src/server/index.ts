import { createWorker } from "./mcp/worker";

// Die App (src/server/app.ts) läuft hinter dem OAuth-Provider des MCP-Connectors; siehe docs/connector.md.
export default createWorker();
