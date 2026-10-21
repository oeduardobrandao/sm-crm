import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { buildConnectUrl, connectLinkLive, connectLinkStatus, isValidEmail } from "../_shared/instagram-connect-link.ts";
import { buildScopeParam } from "../_shared/instagram-scopes.ts";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any; rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

const TTL_DAYS = 30;
const EMAIL_MAX_PER_HOUR = 5;
const START_MAX_PER_HOUR = 10;

export interface ConnectLinkHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  /** APP_BASE_URL. Never OAUTH_REDIRECT_BASE: this URL goes into client emails. */
  appBaseUrl: () => string;
  verifyUser: (bearerToken: string) => Promise<{ id: string } | null>;
  /** auth.users.email for the member, via the Auth admin API. Null on any failure
   *  (deleted user, lookup error) -- the client send must not be blocked by it. */
  getUserEmail: (userId: string) => Promise<string | null>;
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
  /** IG_AUTOMATION_SCOPES_LIVE === "true": whether the optional automation
   *  scopes (comment-to-DM) are requested alongside the base trio. Read from
   *  Deno.env by index.ts and injected here -- handlers never read Deno.env
   *  directly (index/handler convention). */
  automationScopesLive: boolean;
}

/**
 * Resolves the caller and asserts their workspace owns the client.
 *
 * `requireFeature` gates CREATING and SENDING links (POST / and POST /email), not
 * SEEING and REVOKING them (GET / and DELETE /). A plan downgrade must not hide an
 * already-issued link from the agency, nor block revoking it -- that is precisely
 * when revoking matters most. Workspace ownership is checked unconditionally either
 * way; that part is not optional.
 */
async function authorize(
  deps: ConnectLinkHandlerDeps, db: DbClient, req: Request, clienteId: number,
  opts: { requireFeature?: boolean } = {},
): Promise<{ userId: string; contaId: string } | { status: number; error: string }> {
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer === "undefined" || bearer === "null") {
    return { status: 401, error: "Não autorizado" };
  }
  const user = await deps.verifyUser(bearer);
  if (!user) return { status: 401, error: "Não autorizado" };

  // Tenant scope MUST come from active_workspace_id, not the legacy conta_id
  // column. Every RLS policy in this schema resolves the caller's tenant
  // through get_my_conta_id() (20260317_multi_workspace.sql:60,
  // 20260720000004_reconcile_prod_missing_functions.sql:32), which returns
  // profiles.active_workspace_id -- NOT profiles.conta_id. The two diverge
  // permanently the moment a member of more than one workspace switches
  // workspaces: conta_id keeps pointing at wherever they were originally
  // provisioned, while everything the CRM reads and writes -- and every RLS
  // policy -- follows the active one. Scoping this handler by conta_id would
  // authorize a caller against a workspace they are not currently acting in.
  // Mirrors data-import/handler.ts and manage-workspace-user/index.ts, which
  // already do this correctly.
  const { data: profile } = await db
    .from("profiles").select("active_workspace_id").eq("id", user.id).maybeSingle();
  const activeWorkspaceId = profile?.active_workspace_id as string | undefined;
  if (!activeWorkspaceId) return { status: 403, error: "Não autorizado" };

  // A stale active_workspace_id pointing at a workspace the caller has since
  // been removed from must resolve to no tenant at all -- this mirrors the
  // EXISTS clause inside get_my_conta_id(). Without this, a member removed
  // from a workspace could retain a live-looking active_workspace_id and stay
  // authorized against it.
  const { data: membership } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", activeWorkspaceId)
    .maybeSingle();
  if (!membership) return { status: 403, error: "Não autorizado" };
  const contaId = activeWorkspaceId;

  const { data: cliente } = await db.from("clientes").select("conta_id").eq("id", clienteId).single();
  if (!cliente || cliente.conta_id !== contaId) return { status: 403, error: "Não autorizado" };

  if (opts.requireFeature !== false && !(await deps.planFeature(db, contaId, "feature_instagram"))) {
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
        // A malformed percent-escape (e.g. "%E0%A4%A") throws URIError. A bad token
        // in a public URL is an ordinary client error, not a server failure -- it
        // must 404 like an unknown token, not fall through to the generic 500.
        let token: string;
        try {
          token = decodeURIComponent(rawToken ?? "");
        } catch {
          return json({ error: "Not found" }, 404);
        }
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
          // EXPERIMENTO FALHO, não repita: o app do Instagram reivindica `/*` em
          // www.instagram.com no AASA, então em celular com o app instalado a URL
          // de autorização abre o app, que não renderiza a tela de consentimento.
          // Já tentamos passar por api.instagram.com, que o app não reivindica e
          // que faz 302 para www, apostando que o iOS não dispara Universal Link
          // em redirect de servidor. Testado em iPhone com Chrome: NÃO funciona,
          // o app intercepta do mesmo jeito. A mitigação real hoje é a orientação
          // na página pública (ConectarPage).
          const authorizeUrl =
            `https://www.instagram.com/oauth/authorize?client_id=${deps.metaAppId()}` +
            `&redirect_uri=${encodeURIComponent(deps.metaRedirectUri())}` +
            `&response_type=code&scope=${buildScopeParam(deps.automationScopesLive)}&state=${state}`;
          return json({ url: authorizeUrl });
        }

        return json({ error: "Not found" }, 404);
      }

      // ---- Agency: read the current live link -------------------------------
      // No entitlement gate: an agency that downgraded off feature_instagram must
      // still be able to SEE that a link is outstanding (see authorize() above).
      if (req.method === "GET" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId, { requireFeature: false });
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
          // A RPC agora serializa duas abas concorrentes com um advisory lock por
          // cliente (create_instagram_connect_link, na migration) e a segunda
          // encontra e devolve o link que a primeira acabou de criar, sem tentar
          // inserir de novo. Então este fallback de 23505 não é mais o caminho
          // esperado para "duas abas clicando em Gerar ao mesmo tempo" — é defesa
          // em profundidade para o caso residual de uma colisão no índice único
          // parcial acontecer por outra via (ex.: chamada direta à função fora do
          // lock, um outro caller). Se cair aqui, devolve o link vivo em vez de
          // 500, mas não é mais o fluxo normal.
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
      // No entitlement gate: revoking must keep working after a downgrade -- that
      // is exactly when an agency most needs to kill an outstanding link.
      if (req.method === "DELETE" && path === "") {
        const clienteId = parseClienteId(url.searchParams.get("cliente_id"));
        if (clienteId === null) return json({ error: "cliente_id inválido" }, 400);
        const auth = await authorize(deps, db, req, clienteId, { requireFeature: false });
        if ("status" in auth) return json({ error: auth.error }, auth.status);

        // Same per-cliente advisory lock as create_instagram_connect_link (see the
        // migration), so a revoke and a concurrent generate serialize instead of
        // racing. A bare UPDATE here could run between the RPC's revoke and its
        // insert: the DELETE would revoke what existed, report { ok: true }, and
        // the RPC would then commit a brand-new live token underneath it -- the
        // agency told the link is dead while a usable credential is still live.
        const { error } = await db.rpc("revoke_instagram_connect_link", {
          p_cliente_id: clienteId,
          p_conta_id: auth.contaId,
        });
        if (error) {
          // Never report ok: true unless the write actually happened -- telling
          // the agency a credential was revoked when it might still be live is
          // the worst possible lie for this control.
          console.error("[connect-link] revoke RPC failed:", error);
          return json({ error: "Erro interno" }, 500);
        }
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

        // Checked before the rate limit: a client with no live link can never send
        // anything, so a request against one must not spend the agency's 5/hour
        // budget -- that budget exists to bound actual sends, not empty-handed clicks.
        const link = await liveLink(deps, db, clienteId);
        if (!link) return json({ error: "Nenhum link ativo" }, 404);

        // Sem isto o endpoint é um relay de e-mail apontável para qualquer
        // destinatário por qualquer membro autenticado.
        const allowed = await deps.rateLimit(
          db, `ig-connect-link-email:${clienteId}`, EMAIL_MAX_PER_HOUR, 3600,
        );
        if (!allowed) return json({ error: "Muitos envios. Tente novamente mais tarde." }, 429);

        const { data: cliente } = await db.from("clientes").select("nome").eq("id", clienteId).single();
        const { data: workspace } = await db.from("workspaces").select("name").eq("id", auth.contaId).single();
        // auth.users.email, not profiles (profiles has no email column). Best-effort:
        // the client send must go through even if the address can't be resolved.
        const replyTo = await deps.getUserEmail(auth.userId);

        await deps.sendClientEmail({
          to,
          replyTo,
          agencyName: (workspace?.name as string | undefined) ?? "Sua agência",
          clienteName: (cliente?.nome as string | undefined) ?? "seu perfil",
          connectUrl: buildConnectUrl(deps.appBaseUrl(), link.token),
          appBaseUrl: deps.appBaseUrl(),
          // Chave por envio, não determinística: ao contrário do e-mail de boas-vindas
          // (que deve sair exatamente uma vez na vida), este link é reenviável de
          // propósito -- a agência pode mandar de novo como lembrete. Uma chave estável
          // faria o Resend deduplicar o reenvio (janela de 24h) e o endpoint responderia
          // 200 sem nada chegar ao cliente. O rate limit acima é o que limita abuso, não
          // esta chave.
          idempotencyKey: `ig-connect-link:${link.token}:${crypto.randomUUID()}`,
        });
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return internalServerError(json, "instagram-connect-link", err);
    }
  };
}
