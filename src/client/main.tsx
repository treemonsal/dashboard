import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

// Sofortige Rückmeldung beim Drücken: pointerdown setzt data-down (CSS: scale .97), nie erst beim Loslassen.
const clearDown = () => document.querySelectorAll("[data-down]").forEach((el) => el.removeAttribute("data-down"));
document.addEventListener("pointerdown", (e) => (e.target as Element | null)?.closest?.(".press, .press-tab")?.setAttribute("data-down", ""), { capture: true, passive: true });
for (const ev of ["pointerup", "pointercancel", "lostpointercapture", "dragstart"]) document.addEventListener(ev, clearDown, { capture: true, passive: true });
// iOS Safari: :active und Touch-Rückmeldung brauchen einen Touch-Listener am Dokument.
document.addEventListener("touchstart", () => {}, { passive: true });

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
