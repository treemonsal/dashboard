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

// Tastatur: Beim Tippen tritt die Leiste zurück und Eingabe oder Blatt sitzen direkt über der Tastatur.
// --kb ist die Höhe, die die Tastatur vom sichtbaren Bereich wegnimmt.
const vv = window.visualViewport;
const setKb = () => {
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty("--kb", `${Math.round(kb)}px`);
};
vv?.addEventListener("resize", setKb);
vv?.addEventListener("scroll", setKb);
const isText = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button", "submit", "range", "date", "time"].includes(el.type));
document.addEventListener("focusin", (e) => { if (isText(e.target)) { document.documentElement.classList.add("typing"); setKb(); } });
document.addEventListener("focusout", (e) => { if (isText(e.target)) setTimeout(() => { if (!isText(document.activeElement)) document.documentElement.classList.remove("typing"); }, 50); });
// Kein Kontextmenü des Systems bei langem Drücken auf Knöpfe und Verweise.
document.addEventListener("contextmenu", (e) => { if ((e.target as Element | null)?.closest?.("a, button, label, .press")) e.preventDefault(); });

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
