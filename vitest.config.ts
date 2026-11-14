import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ALLOW_LOCAL_NOAUTH: "1",
            // Nur für Tests (test/health): erfundene Werte, keine echten Zugangsdaten.
            GOOGLE_HEALTH_CLIENT_ID: "test-client-id.apps.example",
            GOOGLE_HEALTH_CLIENT_SECRET: "test-client-secret-0000",
            HEALTH_TOKEN_KEY: "test-token-key-test-token-key-test-token-key" },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
