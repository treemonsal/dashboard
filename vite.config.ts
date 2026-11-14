import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      // Eigener Service Worker (src/client/sw.ts): App-Hülle vorhalten und Erinnerungen (push, notificationclick).
      strategies: "injectManifest",
      srcDir: "src/client",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,woff2,svg,png}"] },
      registerType: "autoUpdate",
      injectRegister: false,
      // Hinter Cloudflare Access muss das Manifest mit Cookie geladen werden.
      useCredentials: true,
      includeAssets: ["icons/apple-touch-icon.png", "icons/icon.svg"],
      manifest: {
        id: "/",
        name: "Dashboard",
        short_name: "Dashboard",
        lang: "de-CH",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#000",
        theme_color: "#000",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
