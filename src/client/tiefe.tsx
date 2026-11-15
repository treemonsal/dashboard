// Bausteine für die Tiefe: Unterseiten mit Zurück-Knopf, Standortzeile aus antippbaren Teilen, Zeilen mit Verweis.
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "./router";
import { DetailHead } from "./ui";

export interface Crumb { label: string; href?: string }

/** Standortzeile: z.B. "November · Woche 2 · Sonstiges". Alle Teile ausser dem letzten sind antippbar. */
export function Crumbs({ items }: { items: Crumb[] }) {
  const ref = useRef<HTMLElement>(null);
  const sig = items.map((i) => i.label).join("|");
  useEffect(() => { ref.current?.scrollTo({ left: ref.current.scrollWidth }); }, [sig]);
  if (!items.length) return null;
  return (
    <nav className="crumbs" aria-label="Standort" ref={ref}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${i}-${c.label}`} className="cr">
            {i > 0 && <i aria-hidden="true">·</i>}
            {c.href && !last ? <Link href={c.href} className="press">{c.label}</Link> : <b aria-current={last ? "page" : undefined}>{c.label}</b>}
          </span>
        );
      })}
    </nav>
  );
}

/** Eine Stufe: Kopf mit Zurück (genau eine Stufe), Standortzeile, Inhalt. */
export function Stage({ title, back, crumbs, children }: { title: string; back: string; crumbs?: Crumb[]; children: ReactNode }) {
  return (
    <div className="view">
      <DetailHead title={title} back={back} />
      {crumbs && <Crumbs items={crumbs} />}
      {children}
    </div>
  );
}

export const monthName = (m: string, current: string) => {
  const names = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const n = names[Number(m.slice(5, 7)) - 1] ?? m;
  return m.slice(0, 4) === current.slice(0, 4) ? n : `${n} ${m.slice(0, 4)}`;
};

export const NotFound = () => <div className="card"><div className="empty">Diese Stufe gibt es nicht.</div></div>;
