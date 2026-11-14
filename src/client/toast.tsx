import { useEffect, useState } from "react";

const subs = new Set<(m: string | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Kurze Meldung oben, z.B. wenn ein optimistisches Update zurückgerollt wurde. */
export function notify(msg: string) {
  subs.forEach((s) => s(msg));
  clearTimeout(timer);
  timer = setTimeout(() => subs.forEach((s) => s(null)), 2600);
}

export function Toast() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    subs.add(setM);
    return () => void subs.delete(setM);
  }, []);
  return m ? (
    <div className="toast" role="status">
      {m}
    </div>
  ) : null;
}
