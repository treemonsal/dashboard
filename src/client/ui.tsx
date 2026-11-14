// Bausteine nach docs/entwurf-v3.html. Werte kommen aus tokens.css.
import { useState, type ReactNode } from "react";
import { Link, navigate } from "./router";

/** Schmaler Abstand für Tausender (U+202F). */
const THIN = "\u202f";

const P: Record<string, string> = {
  heute: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2",
  aufgaben: "M5 7h14M5 12h14M5 17h9",
  ziele: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  geld: "M6.5 6h11a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3ZM3.5 10.5h17",
  koerper: "M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20Z",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19 12a7 7 0 0 0-.1-1.2l1.8-1.4-1.8-3.1-2.1.8a7 7 0 0 0-2-1.2L14.4 4h-3.6l-.4 2.9a7 7 0 0 0-2 1.2l-2.1-.8-1.8 3.1 1.8 1.4a7 7 0 0 0 0 2.4l-1.8 1.4 1.8 3.1 2.1-.8a7 7 0 0 0 2 1.2l.4 2.9h3.6l.4-2.9a7 7 0 0 0 2-1.2l2.1.8 1.8-3.1-1.8-1.4c.1-.4.1-.8.1-1.2Z",
  back: "M15 5l-7 7 7 7",
  plus: "M12 5v14M5 12h14",
  up: "M12 19V6M6 11l6-6 6 6",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  chev: "M9 5l7 7-7 7",
  dumbbell: "M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10",
  upload: "M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14",
  coin: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8v8M9.5 10c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.5 2.5 1.5 2.5-.5 2.5-1.5",
  chart: "M5 19V5M5 19h14M8 15l3-4 3 2 4-6",
  cart: "M5 6h2l2 9h8l2-7H8M10 19.5h.01M16 19.5h.01",
  car: "M5 15l1.5-5h11L19 15M5 15v3M19 15v3M5 15h14M8 15h.01M16 15h.01",
  fork: "M7 4v6a2 2 0 0 0 2 2v8M11 4v6a2 2 0 0 1-2 2M16 4c-2 2-2.5 5-2 8h2v8",
  film: "M5 5h14v14H5zM5 9h14M5 15h14M9 5v14M15 5v14",
  dots: "M6 12h.01M12 12h.01M18 12h.01",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
};

export function Icon({ n, className }: { n: keyof typeof P | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={P[n] ?? ""} />
    </svg>
  );
}

export const CheckMark = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <path d="M2.5 6.8 5.3 9.5 10.5 3.8" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Betrag: Franken gross, Rappen halb so gross daneben, "CHF" klein davor. */
const MONEY_SIZE: Record<number, string> = { 15: "var(--t-md)", 16: "var(--t-body)", 17: "var(--t-lg)", 26: "var(--t-stat)", 30: "var(--t-ring)", 34: "var(--t-hero)", 38: "var(--t-big)", 44: "var(--t-xl)", 52: "var(--t-xxl)" };

export function Money({ v, size = 38, cur = true, signed = false, className = "" }: { v: number; size?: number; cur?: boolean; signed?: boolean; className?: string }) {
  const neg = v < 0;
  const abs = Math.abs(Math.round(v * 100) / 100);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const f = whole.toLocaleString("de-CH").replace(/[’']/g, THIN);
  return (
    <span className={`money-n ${className}`} style={{ fontSize: MONEY_SIZE[size] ?? "var(--t-big)" }}>
      {cur && <span className="cur">CHF</span>}
      {neg ? "−" : signed && v > 0 ? "+" : ""}
      {f}
      {cents > 0 && <span className="ct">.{String(cents).padStart(2, "0")}</span>}
    </span>
  );
}

export function Ring({ done, total, size = 112 }: { done: number; total: number; size?: number }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="dring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="tr" cx={size / 2} cy={size / 2} r={r} />
        <circle className="pr" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} strokeDashoffset={total ? c * (1 - Math.min(1, done / total)) : c} />
      </svg>
      <div className="n">
        <span>
          {done}
          <small>/{total}</small>
        </span>
      </div>
    </div>
  );
}

export function Meter({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className={`meter ${className}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Seitenkopf der Unterseiten: runder Zurück-Knopf und zentrierter Titel. */
export function DetailHead({ title, back = "/", right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <div className="dh">
      <Link href={back} className="back press" aria-label="Zurück">
        <Icon n="back" />
      </Link>
      <h1>{title}</h1>
      <div style={{ justifySelf: "end" }}>{right}</div>
    </div>
  );
}

export function Segments<T extends string | number>({ value, options, onChange, full = true, label }: { value: T; options: { v: T; label: ReactNode; n?: number }[]; onChange: (v: T) => void; full?: boolean; label?: string }) {
  return (
    <div className={`seg ${full ? "full" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" className="press" aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
          {o.label}
          {o.n ? <span className="faint">{o.n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function DayToggles({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const nums = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="days" role="group" aria-label={label}>
      {nums.map((n, i) => (
        <button key={n} type="button" className="press" aria-pressed={value.includes(n)} onClick={() => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n])}>
          {names[i]}
        </button>
      ))}
    </div>
  );
}

/** Zweistufiges Löschen im Blatt: erst "Löschen", dann "Wirklich löschen?" mit Abbrechen. */
export function ConfirmDelete({ label = "Löschen", sure = "Wirklich löschen", onConfirm }: { label?: string; sure?: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <div style={{ display: "flex", gap: 10 }}>
      <button type="button" className="cta ghost press" onClick={() => setAsk(false)}>
        Abbrechen
      </button>
      <button type="button" className="cta danger press" onClick={onConfirm}>
        {sure}
      </button>
    </div>
  ) : (
    <button type="button" className="cta ghost press bad" onClick={() => setAsk(true)}>
      {label}
    </button>
  );
}

/** Kleine Linie aus Werten, z.B. Gewicht pro Training. */
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 72, 22 - ((v - min) / span) * 20] as const);
  return (
    <svg className="spark" viewBox="0 0 72 24" aria-hidden="true">
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")} />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="2.5" />
    </svg>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className="empty">
      <span>{children}</span>
      {action &&
        (action.href ? (
          <Link href={action.href} className="chip btn press">
            {action.label}
          </Link>
        ) : (
          <button type="button" className="chip btn press" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

export function RoundAction({ icon, label, onClick, href }: { icon: string; label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <i>
        <Icon n={icon} />
      </i>
      {label}
    </>
  );
  return href ? (
    <Link href={href} className="act press">
      {inner}
    </Link>
  ) : (
    <button type="button" className="act press" onClick={onClick}>
      {inner}
    </button>
  );
}

/** Seitentitel der Hauptseiten. */
export const PageTitle = ({ children }: { children: ReactNode }) => (
  <div className="top"><h1 className="pt">{children}</h1></div>
);

export const go = navigate;
export const nf = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/[’']/g, THIN);
export const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
