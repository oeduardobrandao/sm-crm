import { gerarCalendario, type IcsEvento } from "../_shared/ics.ts";

/** One row of `agenda_feed_eventos(p_token).eventos` (jsonb; dates as strings). */
export interface FeedEventoRow {
  ocorrencia_id: number;
  evento_id: number;
  data_original: string;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local: string | null;
  data_fim_local: string | null;
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
  tz: string;
}

/** `agenda_feed_eventos` result; the RPC returning NULL is surfaced as `null`. */
export interface FeedResultado {
  estado: "ok" | "desligado";
  workspace_nome: string;
  eventos: FeedEventoRow[];
}

/** The subset of an `agenda_listar` row the download needs. */
export interface OcorrenciaIcs {
  ocorrencia_id: number;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local: string | null;
  data_fim_local: string | null;
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
  mascarado: boolean;
}

export type ListarOcorrenciaResultado =
  | { rows: OcorrenciaIcs[] }
  | { erro: "jwt" | "negado" | "outro" };

export interface AgendaFeedDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  /** Service-role rpc. Returns null for an unknown token / removed member; throws on infra errors. */
  feedEventos: (token: string) => Promise<FeedResultado | null>;
  /** Service-role `auth.getUser(jwt)`. */
  getUser: (jwt: string) => Promise<{ id: string } | null>;
  /** `agenda_listar(p_ocorrencia_id)` through an anon-key client carrying the user's JWT (RLS and auth.uid() apply). */
  listarOcorrencia: (jwt: string, id: number) => Promise<ListarOcorrenciaResultado>;
  rateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  hashToken: (t: string) => Promise<string>;
  clientIP: (req: Request) => string;
  now: () => Date;
}

/**
 * Classifies a PostgREST/supabase-js rpc failure from the response `status` and
 * `error`. Status wins over codes: a 401 is always a JWT problem.
 */
export function classificarErroRpc(
  status: number,
  error: { code?: string; message?: string } | null,
): "jwt" | "negado" | "outro" | null {
  if (!error) return null;
  if (status === 401 || /^PGRST30\d$/.test(error.code ?? "")) return "jwt";
  if (error.code === "P0001" && /^(agenda:|feature_disabled)/.test(error.message ?? "")) {
    return "negado";
  }
  return "outro";
}

const TOKEN_RE = /^[0-9a-f]{64}$/;
const FEED_PATH_RE = /^\/([^/]+)\.ics$/;
const OCORRENCIA_PATH_RE = /^\/ocorrencia\/([^/]+)\.ics$/;

function uidOcorrencia(id: number): string {
  return `agenda-oc-${id}@mesaas.com.br`;
}

function paraIcs(r: FeedEventoRow | OcorrenciaIcs): IcsEvento {
  return {
    uid: uidOcorrencia(r.ocorrencia_id),
    inicio: new Date(r.inicio),
    fim: new Date(r.fim),
    diaInteiro: r.dia_inteiro,
    dataInicio: r.data_inicio_local ?? undefined,
    dataFim: r.data_fim_local ?? undefined,
    titulo: r.titulo,
    descricao: r.descricao,
    local: r.local,
    url: r.link_reuniao,
  };
}

/** Lowercase ASCII-only file stem; "evento" when nothing survives (e.g. emoji-only titles). */
export function slugAscii(titulo: string): string {
  const slug = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "evento";
}

/** RFC 5987 attr-char encoding: encodeURIComponent plus the chars it leaves bare. */
function encodeRfc5987(v: string): string {
  return encodeURIComponent(v).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function contentDisposition(titulo: string): string {
  const stem = Array.from(titulo.trim()).slice(0, 80).join("") || "evento";
  return `attachment; filename="${slugAscii(titulo)}.ics"; filename*=UTF-8''${encodeRfc5987(stem)}.ics`;
}

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || !Number.isSafeInteger(n)) return null;
  return n;
}

/** Never let a credential reach the logs: redact the token from whatever the failure says. */
function logSemToken(scope: string, e: unknown, token?: string): void {
  let msg = e instanceof Error ? e.message : typeof e === "string" ? e : "erro desconhecido";
  if (token) msg = msg.split(token).join("[token]");
  console.error(`[agenda-feed] ${scope}:`, msg);
}

export function createAgendaFeedHandler(deps: AgendaFeedDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    const naoEncontrado = () => json({ error: "Não encontrado" }, 404);
    const naoAutorizado = () => json({ error: "Não autorizado" }, 401);
    const erroInterno = () => json({ error: "Erro interno" }, 500);

    // The edge runtime hands the function "/agenda-feed/..."; tolerate the
    // "/functions/v1" gateway prefix too.
    const path = new URL(req.url).pathname.replace(/^(?:\/functions\/v1)?\/agenda-feed/, "");

    // ---- GET /ocorrencia/<id>.ics (user JWT) ------------------------------
    const mOc = OCORRENCIA_PATH_RE.exec(path);
    if (mOc) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (req.method !== "GET") return naoEncontrado();

      const id = parseId(mOc[1]);
      if (id === null) return naoEncontrado();

      const auth = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
      if (!auth) return naoAutorizado();
      const jwt = auth[1];

      try {
        const user = await deps.getUser(jwt);
        if (!user) return naoAutorizado();

        const res = await deps.listarOcorrencia(jwt, id);
        if ("erro" in res) {
          if (res.erro === "jwt") return naoAutorizado();
          if (res.erro === "negado") return naoEncontrado();
          return erroInterno();
        }
        const row = res.rows[0];
        if (!row || row.mascarado) return naoEncontrado();

        const corpo = gerarCalendario({
          nome: row.titulo,
          eventos: [paraIcs(row)],
          agora: deps.now(),
        });
        return new Response(corpo, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": contentDisposition(row.titulo),
            "Cache-Control": "private, no-store",
          },
        });
      } catch (e) {
        logSemToken("download failed", e, jwt);
        return erroInterno();
      }
    }

    // ---- GET|HEAD /<token>.ics (the token is the credential) --------------
    const mFeed = FEED_PATH_RE.exec(path);
    if (!mFeed || (req.method !== "GET" && req.method !== "HEAD")) return naoEncontrado();
    const token = mFeed[1];
    if (!TOKEN_RE.test(token)) return naoEncontrado();

    try {
      const feed = await deps.feedEventos(token);
      if (!feed) {
        const okBad = await deps.rateLimit(`agenda-feed-badtoken:${deps.clientIP(req)}`, 30, 600);
        if (!okBad) return json({ error: "Muitas requisições" }, 429);
        return naoEncontrado();
      }

      const okRead = await deps.rateLimit(`agenda-feed:${await deps.hashToken(token)}`, 60, 3600);
      if (!okRead) return json({ error: "Muitas requisições" }, 429);

      const corpo = gerarCalendario({
        nome: `Mesaas: ${feed.workspace_nome}`,
        eventos: feed.estado === "ok" ? feed.eventos.map(paraIcs) : [],
        agora: deps.now(),
      });
      return new Response(req.method === "HEAD" ? null : corpo, {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Cache-Control": "private, max-age=300",
          "Content-Disposition": 'inline; filename="mesaas-agenda.ics"',
        },
      });
    } catch (e) {
      logSemToken("feed failed", e, token);
      return erroInterno();
    }
  };
}
