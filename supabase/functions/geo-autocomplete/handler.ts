// Address autocomplete proxy for the Agenda "Local" field. The Geoapify key is
// a Supabase secret (GEOAPIFY_API_KEY) and never reaches the browser: the CRM
// calls this function with the user's JWT and gets trimmed suggestions back.

export interface Sugestao {
  /** Full one-line address, what the field receives on pick. */
  rotulo: string;
  /** First line (name or street + number). */
  linha1: string;
  /** Second line (neighborhood, city, state). May be empty. */
  linha2: string;
}

export interface GeoAutocompleteDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  /** Service-role auth.getUser: the user id, or null for a bad/expired token. */
  getUser: (jwt: string) => Promise<{ id: string } | null>;
  rateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  apiKey: () => string | undefined;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export const MIN_TEXTO = 3;
export const MAX_TEXTO = 200;
export const LIMITE_SUGESTOES = 5;
/** Per user: a debounced input fires at most a few calls per second. */
export const RATE_MAX = 60;
export const RATE_JANELA_S = 60;

const GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const TIMEOUT_MS = 5000;

interface GeoapifyResultado {
  formatted?: unknown;
  address_line1?: unknown;
  address_line2?: unknown;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Keeps the useful fields, drops empty and duplicate suggestions. */
export function mapearResultados(body: unknown): Sugestao[] {
  const resultados = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(resultados)) return [];
  const vistos = new Set<string>();
  const out: Sugestao[] = [];
  for (const r of resultados as GeoapifyResultado[]) {
    const rotulo = texto(r?.formatted);
    if (!rotulo || vistos.has(rotulo)) continue;
    vistos.add(rotulo);
    out.push({ rotulo, linha1: texto(r.address_line1) || rotulo, linha2: texto(r.address_line2) });
    if (out.length >= LIMITE_SUGESTOES) break;
  }
  return out;
}

export function urlGeoapify(q: string, apiKey: string): string {
  const p = new URLSearchParams({
    text: q,
    lang: "pt",
    limit: String(LIMITE_SUGESTOES),
    // Bias, not filter: agencies are in Brazil but events can be abroad.
    bias: "countrycode:br",
    format: "json",
    apiKey,
  });
  return `${GEOAPIFY_URL}?${p.toString()}`;
}

export function createGeoAutocompleteHandler(deps: GeoAutocompleteDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", ...extra },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "Não encontrado" }, 404);

    try {
      const auth = req.headers.get("Authorization") ?? "";
      const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!jwt) return json({ error: "Não autorizado" }, 401);
      const user = await deps.getUser(jwt);
      if (!user) return json({ error: "Não autorizado" }, 401);

      const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
      if (q.length < MIN_TEXTO || q.length > MAX_TEXTO) {
        return json({ error: "Texto inválido" }, 400);
      }

      const apiKey = deps.apiKey();
      if (!apiKey) return json({ error: "Indisponível" }, 503);

      if (!(await deps.rateLimit(`geo-autocomplete:${user.id}`, RATE_MAX, RATE_JANELA_S))) {
        return json({ error: "Muitas requisições" }, 429);
      }

      let res: Response;
      try {
        res = await deps.fetch(urlGeoapify(q, apiKey), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        // Only the error name: a message could echo the upstream URL, which carries the key.
        console.error("[geo-autocomplete] upstream fetch failed:", (err as Error)?.name ?? "erro");
        return json({ error: "Indisponível" }, 502);
      }
      if (!res.ok) {
        console.error("[geo-autocomplete] upstream status", res.status);
        return json({ error: "Indisponível" }, 502);
      }
      const sugestoes = mapearResultados(await res.json());
      return json({ sugestoes }, 200, { "Cache-Control": "private, max-age=3600" });
    } catch (err) {
      console.error("[geo-autocomplete] error:", (err as Error)?.name ?? "erro");
      return json({ error: "Erro interno" }, 500);
    }
  };
}
