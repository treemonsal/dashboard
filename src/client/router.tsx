import { useEffect, useState, type AnchorHTMLAttributes } from "react";

// Kleiner Router über die History-API. Reicht für eine Handvoll fester Pfade.
const listeners = new Set<() => void>();

export function navigate(to: string) {
  if (to === location.pathname) return;
  history.pushState(null, "", to);
  listeners.forEach((l) => l());
  document.getElementById("scroller")?.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    />
  );
}
