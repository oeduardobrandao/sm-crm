import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { buildConnectUrl, connectLinkLive, connectLinkStatus, isValidEmail } from "../_shared/instagram-connect-link.ts";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

const TTL_DAYS = 30;
const EMAIL_MAX_PER_HOUR = 5;
const START_MAX_PER_HOUR = 10;
const IG_SCOPES = "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish";

export interface ConnectLinkHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  /** APP_BASE_URL. Never OAUTH_REDIRECT_BASE: this URL goes into client emails. */
  appBaseUrl: () => string;
  verifyUser: (bearerToken: string) => Promise<{ id: string } | null>;
  planFeature: (db: DbClient, contaId: string, featureKey: string) => Promise<boolean>;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  sendClientEmail: (p: {
    to: string;
    replyTo: string | null;
    agencyName: string;
    clienteName: string;
    connectUrl: string;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  createSignedState: (
    clientId: string, userId: string, contaId: string, db: DbClient, linkToken: string,
  ) => Promise<string>;
  metaAppId: () => string;
  metaRedirectUri: () => string;
}

/** Resolves the caller and asserts their workspace owns the client. */
async function authorize(
  deps: ConnectLinkHandlerDeps, db: DbClient, req: Request, clienteId: number,
): Promise<{ userId: string; contaId: string } | { status: number; error: string }> {
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer === "undefined" || bearer === "null") {
    return { status: 401, error: "Não autorizado" };
  }
  const user = await deps.verifyUser(bearer);
  if (!user) return { status: 401, error: "Não autorizado" };

  const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
  const contaId = profile?.conta_id as string | undefined;
  if (!contaId) return { status: 403, error: "Não autorizado" };

  const { data: cliente } = await db.from("clientes").select("conta_id").eq("id", clienteId).single();
  if (!cliente || cliente.conta_id !== contaId) return { status: 403, error: "Não autorizado" };

  if (!(await deps.planFeature(db, contaId, "feature_instagram"))) {
    return { status: 403, error: "feature_disabled" };
  }
  return { userId: user.id, contaId };
}

/** The live link for a client, or null. Expiry is checked here, not by the index. */
async function liveLink(deps: ConnectLinkHandlerDeps, db: DbClient, clienteId: number) {
  const { data } = await db
    .from("instagram_connect_links")
    .select("token, expires_at, revoked_at, created_by")
    .eq("cliente_id", clienteId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  return connectLinkLive(data, deps.now()) ? data : null;
}

/**
 * Only a string or a number is a legitimate cliente_id. Untyped JSON bodies can hand
 * this an array or object; String([42]) === "42" would slip an array straight past a
 * naive regex check, so those types are rejected before the regex ever runs.
 */
function parseClienteId(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (!raw || !/^\d+$/.test(String(raw))) return null;
  const n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

export function createConnectLinkHandler(deps: ConnectLinkHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const path = url.pathname.replace("/instagram-connect-link", "").replace(/\/$/, "");
    const db = deps.createDb();

    try {
      // =====================================================================
      // ROTAS PÚBLICAS. Sem JWT, por desenho. Tudo abaixo é alcançável por
      // qualquer pessoa que tenha a URL. Não acrescente nada aqui que leia
      // dados do workspace além do nome da agência e do nome do cliente.
      // =====================================================================

      if (path.startsWith("/public/")) {
        const rest = path.slice("/public/".length);
        const [rawToken, action] = rest.split("/");
        const token = decodeURIComponent(rawToken ?? "");
        if (!token) return json({ error: "Not found" }, 404);

        const { data: link } = await db
          .from("instagram_connect_links")
          .select("token, cliente_id, conta_id, created_by, expires_at, revoked_at")
          .eq("token", token)
          .maybeSingle();
        if (!link) return json({ error: "Not found" }, 404);

        const status = connectLinkStatus(link, deps.now());

        if (req.method === "GET" && !action) {
          if (status !== "live") return json({ status });
          if (!(await deps.planFeature(db, link.conta_id, "feature_instagram"))) {
            return json({ status: "unavailable" });
          }
          const { data: cliente } = await db
            .from("clientes").select("nome").eq("id", link.cliente_id).maybeSingle();
          const { data: workspace } = await db
            .from("workspaces").select("name").eq("id", link.conta_id).maybeSingle();
          const { data: account } = await db
            .from("instagram_accounts")
            .select("username, authorization_status")
            .eq("client_id", link.cliente_id)
            .maybeSingle();
          return json({
            status: "live",
            cliente_name: (cliente?.nome as string | undefined) ?? "",
            workspace_name: (workspace?.name as string | undefined) ?? "",
            connected_username:
              account && account.authorization_status === "active"
                ? ((account.username as string | undefined) ?? null)
                : null,
          });
        }

        if (req.method === "POST" && action === "start") {
          if (status !== "live") return json({ error: "Not found" }, 404);
          if (!(await deps.planFeature(db, link.conta_id, "feature_instagram"))) {
            return json({ error: "Not found" }, 404);
          }
          // Cada start insere uma linha em oauth_states. Sem limite, um endpoint
          // público vira amplificador de escrita.
          const allowed = await deps.rateLimit(
            db, `ig-connect-link-start:${token}`, START_MAX_PER_HOUR, 3600,
          );
          if (!allowed) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

          // userId do state é o membro que gerou o link: é ele que a auditoria
          // e a notificação vão referenciar.
          const state = await deps.createSignedState(
            String(link.cliente_id), link.created_by, link.conta_id, db, token,
          );
          const authorizeUrl =
            `https://www.instagram.com/oauth/authorize?client_id=${deps.metaAppId()}` +
            `&redirect_uri=${encodeURIComponent(deps.metaRedirectUri())}` +
            `&response_type=code&scope=${IG_SCOPES}&state=${state}`;
          return json({ url: authorizeUrl });
        }

        return json({ error: "Not found" }, 404);
      }

      // ---- Agency: read the current live link -------------------------------
      if (req.method === "GET" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        const link = await liveLink(deps, db, clienteId);
        return json({
          link: link
            ? { url: buildConnectUrl(deps.appBaseUrl(), link.token), expires_at: link.expires_at }
            : null,
        });
      }

      // ---- Agency: generate (revoke-and-insert, atomic in the RPC) ----------
      if (req.method === "POST" && path === "") {
        const body = await req.json().catch(() => ({}));
        const clienteId = parseClienteId(body?.cliente_id);
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        const { data, error } = await db.rpc("create_instagram_connect_link", {
          p_cliente_id: clienteId,
          p_conta_id: auth.contaId,
          p_created_by: auth.userId,
          p_ttl_days: TTL_DAYS,
        });

        if (error) {
          // O fallback abaixo existe SÓ para duas abas clicando em "Gerar" ao mesmo
          // tempo: a segunda colide no índice único parcial (Postgres SQLSTATE
          // 23505) e isso não é erro para a agência, é o link que ela já queria.
          // Qualquer outro código (params inválidos, permissão, falha transitória)
          // tem que virar 500 de verdade — devolver 200 com um link stale esconderia
          // o erro do monitoramento de taxa de erro.
          const code = (error as { code?: string } | null)?.code;
          if (code === "23505") {
            const existing = await liveLink(deps, db, clienteId);
            if (existing) {
              return json({
                link: { url: buildConnectUrl(deps.appBaseUrl(), existing.token), expires_at: existing.expires_at },
              });
            }
            // Violação de unicidade sem link ativo é incoerente — não é o caso de
            // "duas abas colidindo", então não deve ser reportado como sucesso.
          }
          console.error("[connect-link] RPC failed:", error);
          return json({ error: "Erro interno" }, 500);
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.token) return json({ error: "Erro interno" }, 500);
        return json({
          link: { url: buildConnectUrl(deps.appBaseUrl(), row.token), expires_at: row.expires_at },
        });
      }

      // ---- Agency: revoke ---------------------------------------------------
      if (req.method === "DELETE" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        await db
          .from("instagram_connect_links")
          .update({ revoked_at: deps.now() })
          .eq("cliente_id", clienteId)
          .is("revoked_at", null);
        return json({ ok: true });
      }

      // ---- Agency: email the link to the client -----------------------------
      if (req.method === "POST" && path === "/email") {
        const body = await req.json().catch(() => ({}));
        const clienteId = parseClienteId(body?.cliente_id);
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const to = String(body?.email ?? "").trim();
        if (!isValidEmail(to)) return json({ error: "E-mail inválido" }, 400);

        const auth = await authorize(deps, db, req, clienteId);
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        // Sem isto o endpoint é um relay de e-mail apontável para qualquer
        // destinatário por qualquer membro autenticado.
        const allowed = await deps.rateLimit(
          db, `ig-connect-link-email:${clienteId}`, EMAIL_MAX_PER_HOUR, 3600,
        );
        if (!allowed) return json({ error: "Muitos envios. Tente novamente mais tarde." }, 429);

        const link = await liveLink(deps, db, clienteId);
        if (!link) return json({ error: "Nenhum link ativo" }, 404);

        const { data: cliente } = await db.from("clientes").select("nome").eq("id", clienteId).single();
        const { data: workspace } = await db.from("workspaces").select("name").eq("id", auth.contaId).single();
        const { data: profile } = await db.from("profiles").select("email").eq("id", auth.userId).single();

        await deps.sendClientEmail({
          to,
          replyTo: (profile?.email as string | undefined) ?? null,
          agencyName: (workspace?.name as string | undefined) ?? "Sua agência",
          clienteName: (cliente?.nome as string | undefined) ?? "seu perfil",
          connectUrl: buildConnectUrl(deps.appBaseUrl(), link.token),
          appBaseUrl: deps.appBaseUrl(),
          idempotencyKey: `ig-connect-link:${link.token}:${to}`,
        });
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return internalServerError(json, "instagram-connect-link", err);
    }
  };
}
