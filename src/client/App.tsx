import { Aufgaben, Heute, Leer, Pruefung, Schule } from "./pages";
import { Link, usePath } from "./router";

const TABS = [
  { href: "/", label: "Heute" },
  { href: "/aufgaben", label: "Aufgaben" },
  { href: "/kalender", label: "Kalender" },
  { href: "/schule", label: "Schule" },
  { href: "/finanzen", label: "Finanzen" },
  { href: "/gesundheit", label: "Gesundheit" },
];

function View({ path }: { path: string }) {
  const exam = /^\/schule\/pruefungen\/([A-Za-z0-9_-]+)$/.exec(path);
  if (exam) return <Pruefung key={exam[1]} id={exam[1]} />;
  switch (path) {
    case "/":
      return <Heute />;
    case "/aufgaben":
      return <Aufgaben />;
    case "/schule":
      return <Schule />;
    case "/kalender":
      return <Leer title="Kalender" text="Die Verbindung mit Google Kalender folgt in Stufe 1." />;
    case "/finanzen":
      return <Leer title="Finanzen" text="Hier erscheinen die Monatsübersichten, sobald die Bank-Exporte eingelesen werden können." />;
    case "/gesundheit":
      return <Leer title="Gesundheit" text="Schlaf, Schritte und Ruhepuls erscheinen hier, sobald Google Health verbunden ist." />;
    default:
      return <Leer title="Nicht gefunden" text="Diese Seite gibt es nicht." />;
  }
}

export function App() {
  const path = usePath();
  const active = TABS.filter((t) => (t.href === "/" ? path === "/" : path.startsWith(t.href))).at(-1)?.href;
  return (
    <>
      <main className="shell">
        <View key={path} path={path} />
      </main>
      <nav className="tabbar" aria-label="Bereiche">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
