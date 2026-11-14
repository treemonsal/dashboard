// Zeile, die sich nach links wischen lässt: Schwelle, dann "erledigt", und mit Feder zurück.
import { useRef, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { CheckMark } from "./ui";

const THRESH = 84;

export function SwipeRow({ children, onComplete, disabled, onTap }: { children: ReactNode; onComplete: () => void; disabled?: boolean; onTap?: () => void }) {
  const x = useMotionValue(0);
  const st = useRef<{ id: number; x0: number; y0: number; on: boolean; s: { x: number; t: number }[] } | null>(null);
  const moved = useRef(false);
  const o = useTransform(x, [-THRESH, -16, 0], [1, 0.4, 0]);
  const sc = useTransform(x, [-THRESH * 1.2, -THRESH, -20, 0], [1.15, 1, 0.7, 0.5]);

  if (disabled) return <div className="swipe"><div className="over" onClick={onTap}>{children}</div></div>;

  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-noswipe]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    moved.current = false;
    x.stop();
    st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, s: [{ x: e.clientX, t: e.timeStamp }] };
  };
  const move = (e: RPointerEvent) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        st.current = null;
        return;
      }
      if (dx < -8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        s.on = true;
        s.x0 = e.clientX;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Zeiger schon weg */ }
      } else return;
    }
    moved.current = true;
    const d = e.clientX - s.x0;
    x.set(d < 0 ? d : Math.pow(d, 0.7) * 0.5);
    s.s.push({ x: e.clientX, t: e.timeStamp });
    while (s.s.length > 2 && e.timeStamp - s.s[0].t > 100) s.s.shift();
  };
  const up = (e: RPointerEvent) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    st.current = null;
    if (!s.on) return;
    const a = s.s[0], b = s.s[s.s.length - 1];
    const v = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
    const passed = x.get() + v * 0.12 < -THRESH;
    if (passed) onComplete();
    animate(x, 0, { type: "spring", duration: 0.5, bounce: passed ? 0.3 : 0.15, velocity: v });
  };

  return (
    <div className="swipe" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={(e) => {
      if (moved.current) { e.stopPropagation(); e.preventDefault(); }
    }}>
      <motion.div className="under" style={{ opacity: o }} aria-hidden="true">
        <motion.span style={{ scale: sc, display: "grid" }}><CheckMark /></motion.span>
      </motion.div>
      <motion.div className="over" style={{ x }} onClick={() => { if (!moved.current) onTap?.(); }}>
        {children}
      </motion.div>
    </div>
  );
}
