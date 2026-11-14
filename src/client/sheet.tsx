// Blatt von unten. Folgt dem Finger 1:1 (Pointer Events mit setPointerCapture), der Schwung entscheidet beim Loslassen,
// nach oben gibt es ein Gummiband, jederzeit greifbar und umkehrbar. Federn kommen aus `motion` (bounce 0, nur nach Wurf leicht).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";

interface Ctl {
  open: (node: ReactNode) => void;
  close: () => void;
}
const Ctx = createContext<Ctl>({ open: () => {}, close: () => {} });
export const useSheet = () => useContext(Ctx);

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const rubber = (x: number) => Math.pow(x, 0.72);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const [gen, setGen] = useState(0);
  const closer = useRef<(() => void) | null>(null);
  const isOpen = useRef(false);
  const open = useCallback((n: ReactNode) => {
    if (!isOpen.current) {
      isOpen.current = true;
      setGen((g) => g + 1);
    }
    setNode(n);
  }, []);
  const close = useCallback(() => closer.current?.(), []);
  const ctl = useMemo(() => ({ open, close }), [open, close]);
  return (
    <Ctx.Provider value={ctl}>
      {children}
      {node && (
        <Sheet
          key={gen}
          register={(f) => (closer.current = f)}
          onClosed={() => {
            isOpen.current = false;
            setNode(null);
          }}
        >
          {node}
        </Sheet>
      )}
    </Ctx.Provider>
  );
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  base: number; // y des Blatts bei Beginn
  zone: "grab" | "body";
  on: boolean;
  samples: { y: number; t: number }[];
}

function Sheet({ children, onClosed, register }: { children: ReactNode; onClosed: () => void; register: (f: () => void) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const reduced = useMemo(reducedMotion, []);
  const y = useMotionValue(typeof window === "undefined" ? 800 : window.innerHeight);
  const shown = useMotionValue(0); // nur bei reduzierter Bewegung: Überblenden
  const H = useRef(800);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const drag = useRef<Drag | null>(null);
  const closing = useRef(false);
  const token = useRef(0);

  const scrim = useTransform(y, (v) => (reduced ? shown.get() : Math.max(0, Math.min(1, 1 - v / (H.current || 1)))));
  const scrimO = useTransform([y, shown], ([v, s]) => (reduced ? (s as number) * Math.max(0, Math.min(1, 1 - (v as number) / (H.current || 1))) : Math.max(0, Math.min(1, 1 - (v as number) / (H.current || 1)))));
  void scrim;
  const sheetO = useTransform(shown, (s) => (reduced ? s : 1));

  const run = useCallback(
    (to: number, v = 0, bounce = 0) => {
      anim.current?.stop();
      const closeIt = to > 0;
      closing.current = closeIt;
      const my = ++token.current; // nur die jüngste Animation darf das Blatt schliessen
      const done = () => my === token.current && closeIt && onClosed();
      if (reduced) {
        y.set(0);
        anim.current = animate(shown, closeIt ? 0 : 1, { duration: 0.18, onComplete: done });
        return;
      }
      anim.current = animate(y, to, { type: "spring", duration: closeIt ? 0.38 : 0.46, bounce, velocity: v, onComplete: done });
    },
    [onClosed, reduced, shown, y],
  );

  const requestClose = useCallback(() => run(H.current + 40), [run]);

  useLayoutEffect(() => {
    H.current = root.current?.offsetHeight ?? window.innerHeight;
    if (reduced) {
      y.set(0);
      run(0);
    } else {
      y.set(H.current + 40);
      run(0);
    }
    register(requestClose);
    document.documentElement.classList.add("locked");
    return () => document.documentElement.classList.remove("locked");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (H.current = el.offsetHeight));
    ro.observe(el);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKey);
    el.focus({ preventScroll: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [requestClose]);

  // Touch: Ziehen nach unten am oberen Rand des Inhalts gehört dem Blatt, nicht dem Scrollen.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let sy = 0, sx = 0;
    const ts = (e: TouchEvent) => {
      sy = e.touches[0].clientY;
      sx = e.touches[0].clientX;
    };
    const tm = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - sy;
      const dx = e.touches[0].clientX - sx;
      if (drag.current?.on || (el.scrollTop <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx)) || y.get() > 1) {
        if (e.cancelable) e.preventDefault();
      }
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
    };
  }, [y]);

  const down = (e: RPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement;
    const zone = t.closest("[data-grab]") ? "grab" : "body";
    if (zone === "body" && t.closest("input,textarea,select")) return;
    // Läuft gerade eine Animation (auch das Schliessen), wird sie hier angehalten und das Blatt gegriffen.
    anim.current?.stop();
    token.current++; // eine laufende Schliess-Animation gilt ab jetzt nicht mehr
    closing.current = false;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: y.get(), zone, on: false, samples: [{ y: e.clientY, t: e.timeStamp }] };
    if (zone === "grab" || y.get() > 1) begin(e);
  };
  const begin = (e: RPointerEvent) => {
    const d = drag.current!;
    d.on = true;
    d.y0 = e.clientY;
    d.base = y.get();
    try { root.current?.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      const dxx = Math.abs(e.clientX - d.x0);
      const ddy = e.clientY - d.y0;
      if (d.zone === "body" && (body.current?.scrollTop ?? 0) <= 0 && ddy > 5 && ddy > dxx * 1.2) begin(e);
      else {
        d.samples = [{ y: e.clientY, t: e.timeStamp }];
        return;
      }
    }
    const raw = d.base + (e.clientY - d.y0);
    y.set(raw < 0 ? -rubber(-raw) : raw);
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    void dy;
  };
  const up = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.on) {
      if (closing.current || y.get() > 1) run(closing.current ? H.current + 40 : 0);
      return;
    }
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px/s, positiv = nach unten
    const cur = y.get();
    const projected = cur + v * 0.12;
    const doClose = projected > H.current * 0.3 || v > 900;
    if (doClose) run(H.current + 40, v, 0);
    else run(0, v, Math.abs(v) > 600 ? 0.18 : 0);
  };

  return (
    <>
      <motion.div className="scrim" style={{ opacity: scrimO }} onClick={requestClose} />
      <motion.div
        ref={root}
        className="sheet"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{ y: reduced ? 0 : y, opacity: sheetO, translateY: reduced ? y : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="grab" data-grab>
          <i />
        </div>
        <div className="sh" ref={body}>
          {children}
        </div>
      </motion.div>
    </>
  );
}
