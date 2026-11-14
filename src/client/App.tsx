import { SheetProvider } from "./sheet";
import { Toast } from "./toast";
import { Link, usePath } from "./router";
import { Icon } from "./ui";
import { Aufgaben, Heute, Ziele } from "./pages-heute";
import { Woche } from "./kalender";
import { Analyse, Einstellungen, Geld, Koerper, Plaene, Zeit } from "./pages-rest";

const TABS = [
  { href: "/", label: "Heute", icon: "heute" },
  { href: "/aufgaben", label: "Aufgaben", icon: "aufgaben" },
  { href: "/ziele", label: "Ziele", icon: "ziele" },
  { href: "/geld", label: "Geld", icon: "geld" },
  { href: "/koerper", label: "Körper", icon: "koerper" },
];
// Unterseiten gehören zu einem Tab
const PARENT: Record<string, string> = { "/plaene": "/ziele", "/analyse": "/geld", "/zeit": "/", "/woche": "/", "/einstellungen": "/" };

function View({ path }: { path: string }) {
  switch (path) {
    case "/": return <Heute />;
    case "/aufgaben": return <Aufgaben />;
    case "/ziele": return <Ziele />;
    case "/geld": return <Geld />;
    case "/koerper": return <Koerper />;
    case "/plaene": return <Plaene />;
    case "/analyse": return <Analyse />;
    case "/zeit": return <Zeit />;
    case "/woche": return <Woche />;
    case "/einstellungen": return <Einstellungen />;
    default: return <div className="view"><div className="card"><div className="empty">Diese Seite gibt es nicht.</div></div></div>;
  }
}

export function App() {
  const path = usePath();
  const active = PARENT[path] ?? path;
  return (
    <SheetProvider>
      <div className="scroller" id="scroller">
        <main className="app">
          <View key={path} path={path} />
        </main>
      </div>
      <nav className="tabs" aria-label="Bereiche">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="press-tab" aria-label={t.label} aria-current={t.href === active ? "page" : undefined}>
            <Icon n={t.icon} />
          </Link>
        ))}
      </nav>
      <Toast />
    </SheetProvider>
  );
}
