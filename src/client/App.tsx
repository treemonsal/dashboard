import type { MouseEvent } from "react";
import { SheetProvider } from "./sheet";
import { Toast } from "./toast";
import { Link, usePath } from "./router";
import { Icon } from "./ui";
import { Aufgaben, Heute, Ziele } from "./pages-heute";
import { Woche } from "./kalender";
import { Einstellungen, Geld, Koerper, Plaene, Zeit } from "./pages-rest";
import { GeldTiefe } from "./geld-tiefe";
import { KoerperTiefe } from "./koerper-tiefe";
import { ZieleTiefe } from "./schule-tiefe";
import { ZeitTiefe } from "./zeit-tiefe";

const TABS = [
  { href: "/", label: "Heute", icon: "heute" },
  { href: "/aufgaben", label: "Aufgaben", icon: "aufgaben" },
  { href: "/ziele", label: "Ziele", icon: "ziele" },
  { href: "/geld", label: "Geld", icon: "geld" },
  { href: "/koerper", label: "Körper", icon: "koerper" },
];
// Unterseiten gehören zu einem Tab
const PARENT: Record<string, string> = { "/plaene": "/ziele", "/zeit": "/", "/woche": "/", "/einstellungen": "/" };

/** Zu welchem Symbol in der Leiste eine Adresse gehört (auch alle Stufen darunter). */
export function activeTab(path: string): string {
  const first = "/" + (path.split("/")[1] ?? "");
  if (path === "/analyse") return "/geld";
  if (TABS.some((t) => t.href !== "/" && t.href === first)) return first;
  return PARENT[path] ?? PARENT[first] ?? path;
}

function View({ path }: { path: string }) {
  if (path === "/analyse") return <GeldTiefe path="/geld/analyse" />;
  if (path === "/trainings") return <KoerperTiefe path="/koerper/trainings" />;
  if (path.startsWith("/zeit/")) return <ZeitTiefe path={path} />;
  if (path.startsWith("/ziele/")) return <ZieleTiefe path={path} />;
  if (path.startsWith("/koerper/")) return <KoerperTiefe path={path} />;
  if (path.startsWith("/geld/")) return <GeldTiefe path={path} />;
  switch (path) {
    case "/": return <Heute />;
    case "/aufgaben": return <Aufgaben />;
    case "/ziele": return <Ziele />;
    case "/geld": return <Geld />;
    case "/koerper": return <Koerper />;
    case "/plaene": return <Plaene />;
    case "/zeit": return <Zeit />;
    case "/woche": return <Woche />;
    case "/einstellungen": return <Einstellungen />;
    default: return <div className="view"><div className="card"><div className="empty">Diese Seite gibt es nicht.</div></div></div>;
  }
}

/** Tipp auf das Symbol der aktuellen Seite: weich nach oben. Von einer Unterseite zuerst zur Hauptseite. */
function onTab(e: MouseEvent<HTMLAnchorElement>, href: string, path: string, active: string) {
  if (href !== active || path !== href) return; // Unterseite oder andere Seite: normale Navigation
  e.preventDefault();
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("scroller")?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}

export function App() {
  const path = usePath();
  const active = activeTab(path);
  return (
    <SheetProvider>
      <div className="scroller" id="scroller">
        <main className="app">
          <View key={path} path={path} />
        </main>
      </div>
      <nav className="tabs" aria-label="Bereiche">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="press-tab" onClick={(e) => onTab(e, t.href, path, active)} aria-label={t.label} aria-current={t.href === active ? "page" : undefined}>
            <Icon n={t.icon} />
          </Link>
        ))}
      </nav>
      <Toast />
    </SheetProvider>
  );
}
