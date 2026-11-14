# Stand Connector
- Fertig: Connector komplett (OAuth 2.1 + MCP, KV dashboard-oauth existiert, keine Durable Objects), 54 Tests in test/mcp, echter Durchlauf test/mcp/durchlauf.mjs, docs/connector.md; Build wie deploy.mjs per dry-run geprüft.
- Für Kalender eingetragen: scheduled-Handler in index.ts (runScheduled aus cron.ts) und triggers.crons ["*/5 * * * *"] in wrangler.jsonc.
- Als Nächstes (Tim): Access-Bypass für /mcp, /oauth/token, /oauth/register, /.well-known setzen, deployen, in Claude/ChatGPT verbinden (docs/connector.md).
