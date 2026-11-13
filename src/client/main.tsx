import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

// Dunkel ist Standard. Hell nur auf ausdrücklichen Wunsch (localStorage "theme" = "light").
try {
  if (localStorage.getItem("theme") === "light") document.documentElement.dataset.theme = "light";
} catch {
  /* Speicher gesperrt: dunkel bleiben */
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD) registerSW({ immediate: true });
