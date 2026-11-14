// Nachgestellter Google-Server für die Tests: OAuth-Token-Endpunkt und Health API v4.
import * as fx from "./fixtures";

export interface Call { method: string; url: URL; auth: string | null; body: string; form: URLSearchParams | null }

export interface FakeOpts {
  /** Antwort auf grant_type=refresh_token */
  refresh?: (n: number) => Response;
  /** Pfadteil (z.B. "weight") -> Antwort, überschreibt die Standardantwort */
  override?: Record<string, (n: number, auth: string | null) => Response>;
  /** gültige Zugriffstoken */
  valid?: (token: string) => boolean;
}

export const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export function fakeGoogle(opts: FakeOpts = {}) {
  const calls: Call[] = [];
  let refreshes = 0;
  const hits: Record<string, number> = {};
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const form = headers.get("content-type")?.includes("x-www-form-urlencoded") ? new URLSearchParams(body) : null;
    calls.push({ method, url, auth: headers.get("authorization"), body, form });

    if (url.pathname === "/token") {
      const gt = form?.get("grant_type");
      if (gt === "authorization_code") {
        if (form?.get("code") !== "gueltiger-code" || !form.get("code_verifier")) return j({ error: "invalid_grant" }, 400);
        return j({ access_token: "access-1", refresh_token: "refresh-geheim-1", expires_in: 3599, scope: "a b", token_type: "Bearer" });
      }
      if (gt === "refresh_token") {
        refreshes++;
        if (opts.refresh) return opts.refresh(refreshes);
        return j({ access_token: `access-${refreshes + 1}`, expires_in: 3599, scope: "a b", token_type: "Bearer" });
      }
      return j({ error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/revoke") return j({});

    const auth = headers.get("authorization");
    const tok = auth?.replace(/^Bearer /, "") ?? "";
    if (!auth || (opts.valid && !opts.valid(tok))) return j({ error: { code: 401 } }, 401);
    const key = url.pathname.includes(":dailyRollUp") ? "steps" : (/dataTypes\/([^/]+)\/dataPoints/.exec(url.pathname)?.[1] ?? "?");
    hits[key] = (hits[key] ?? 0) + 1;
    const ov = opts.override?.[key];
    if (ov) return ov(hits[key], auth);
    switch (key) {
      case "steps": return j(fx.stepsRollup);
      case "daily-resting-heart-rate": return j(fx.restingHr);
      case "weight": return j(fx.weight);
      case "sleep": return j(fx.sleep);
      case "exercise": return j(fx.exercise);
    }
    return j({ error: "unbekannt" }, 404);
  }) as typeof fetch;
  return { fetcher, calls, get refreshes() { return refreshes; } };
}
