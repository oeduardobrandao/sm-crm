// Lista as midias publicadas de um cliente consultando a Graph API do
// Instagram AO VIVO (nunca a tabela espelho `instagram_posts`): um feed pode
// ter sincronizado com sucesso e ainda assim nao ter o post mais recente
// (ex.: publicado apos o ultimo sync), e esta rota existe justamente para
// re-mirar uma automacao orfa num post ja publicado -- inclusive esse.
import { hasPermissionFor } from "../_shared/permissions.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";

// `svc` e tipado estruturalmente de proposito: `ReturnType<typeof createClient>`
// faz o `deno check` inferir `never` nas linhas de `.from(...)`.
// `verifyClientOwnership` recebe o MESMO tipo estrutural de `svc` (nao
// `unknown`): com `strictFunctionTypes` o `deno check` rejeita atribuir a
// funcao local de index.ts (cujo parametro `svc` e `{ from: ... }`) a um slot
// tipado `unknown`, porque `unknown` nao e atribuivel a `{ from: ... }`.
// deno-lint-ignore no-explicit-any
type Svc = { from: (t: string) => any; rpc: (n: string, p: Record<string, unknown>) => any };

// Prazo default da chamada a Graph API. Injetavel via `Deps.graphTimeoutMs`
// (so pra teste: precisa de um prazo pequeno de verdade pra exercitar
// makeBoundedFetch sem o teste levar 10s de verdade). Producao nunca passa
// esse campo, entao fica sempre neste valor.
export const GRAPH_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export type Deps = {
  svc: Svc;
  userId: string;
  corsHeaders: Record<string, string>;
  decryptToken: (encryptedBase64: string) => Promise<string>;
  verifyClientOwnership: (svc: Svc, clientId: string, contaId: string) => Promise<boolean>;
  // Injetado, nunca importado direto de `_shared/rate-limit.ts` aqui: o
  // helper de la e tipado pra `SupabaseClient` (nao pro `Svc` estrutural
  // deste arquivo). O index.ts fecha sobre o `serviceClient` real e repassa
  // so a assinatura fina que este handler precisa -- mesma tatica de
  // `verifyClientOwnership`/`decryptToken` acima.
  checkRateLimit: (key: string, maxRequests: number, windowSeconds: number) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  graphTimeoutMs?: number;
};

export type PublishedMediaItem = {
  id: string;
  caption: string | null;
  media_type: string;
  thumbnail_url: string | null;
  permalink: string;
  timestamp: string;
};

// Formato bruto que a Graph devolve por item de `/me/media`. `media_url` e
// `children` sao opcionais porque so vem preenchidos conforme o `media_type`
// (ver comentario no fallback do mapeamento abaixo) -- por isso este tipo,
// mais frouxo que `PublishedMediaItem`, em vez de `Record<string, string>`.
type GraphMediaItem = {
  id: string;
  caption?: string | null;
  media_type: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
  permalink: string;
  timestamp: string;
  children?: { data?: { media_url?: string | null }[] };
};

export async function handlePublishedMedia(req: Request, deps: Deps): Promise<Response> {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...deps.corsHeaders, "Content-Type": "application/json" } });

  // 1. clientId no path, mesmo formato de /posts/:clientId
  const path = new URL(req.url).pathname.replace("/instagram-integration", "");
  const clientId = path.split("/")[2];
  if (!clientId || !/^\d+$/.test(clientId)) return json({ error: true, message: "Invalid client ID" }, 400);

  // 2. Tenant pelo padrao NOVO: active_workspace_id + workspace_members.
  //    NAO copiar o profiles.conta_id das rotas antigas desta funcao: com
  //    conta_id um usuario multi-workspace opera na workspace errada e um
  //    membro removido mantem acesso.
  const { data: profile } = await deps.svc.from("profiles").select("active_workspace_id").eq("id", deps.userId).single();
  const contaId = profile?.active_workspace_id as string | undefined;
  if (!contaId) return json({ error: true, message: "Forbidden" }, 403);
  const { data: member } = await deps.svc.from("workspace_members")
    .select("user_id").eq("workspace_id", contaId).eq("user_id", deps.userId).maybeSingle();
  if (!member) return json({ error: true, message: "Forbidden" }, 403);

  // 3. Permissao: automacoes:'editar', a MESMA que a RLS ica_update exige.
  //    NAO e owner/admin: o preset de agent tem esse nivel desde 20260904000002
  //    (Migracao B), que preservou a escrita livre que 20260829000002 ja dava.
  if (!await hasPermissionFor(deps.svc, deps.userId, contaId, "automacoes", "editar")) {
    return json({ error: true, message: "Forbidden" }, 403);
  }

  // 4. Propriedade do cliente, ANTES de tocar em token.
  if (!await deps.verifyClientOwnership(deps.svc, clientId, contaId)) {
    return json({ error: true, message: "Forbidden" }, 403);
  }

  // 4.1 Rate limit -- mesmo padrao do POST /sync (index.ts, rota 3), so que
  // mais generoso: paginacao interativa faz varias chamadas curtas em
  // sequencia, enquanto o /sync e uma operacao pesada (5 chamadas / 5 min,
  // varias idas na Graph por invocacao). A quota da Graph e POR APP,
  // compartilhada entre todas as workspaces: sem limite aqui, um unico
  // membro com automacoes:editar iterando `limit=50` em loop degrada a Graph
  // pra TODOS os tenants, nao so pro dele.
  const rateLimitAllowed = await deps.checkRateLimit(`ig-published-media:${contaId}:${clientId}`, 30, 60);
  if (!rateLimitAllowed) {
    // Mesmo formato { error: true, code, message } que o 409 abaixo -- nao
    // deixar o cliente adivinhar o `code` a partir do `status` HTTP sozinho.
    return json(
      { error: true, code: "rate_limited", message: "Muitas requisicoes seguidas. Aguarde um minuto e tente novamente." },
      429,
    );
  }

  // 5. Conta e status. Token nulo com conta 'active' (registro incompleto)
  // cai no MESMO 409 de "nao autorizada": nao ha credencial pra
  // descriptografar, entao nao e um 404 de "conta inexistente" nem algo que
  // deva estourar antes do try mais abaixo.
  const { data: account } = await deps.svc.from("instagram_accounts")
    .select("id, encrypted_access_token, authorization_status").eq("client_id", clientId).single();
  if (!account) return json({ error: true, message: "Not found" }, 404);
  if (account.authorization_status !== "active" || !account.encrypted_access_token) {
    return json({ error: true, code: "instagram_not_authorized", message: "Conta do Instagram nao autorizada" }, 409);
  }

  // 6. Corpo ANTES do decrypt: um corpo JSON valido igual a `null` (o
  // `.catch()` abaixo so pega JSON invalido, nao um `null` bem formado) ou
  // qualquer outro corpo nao-objeto falha rapido aqui, sem nunca ter tocado
  // na credencial -- defesa em profundidade de graca.
  const rawBody = await req.json().catch(() => ({}));
  const body: Record<string, unknown> = rawBody && typeof rawBody === "object" ? rawBody as Record<string, unknown> : {};
  const limit = Math.floor(Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT)));

  // 7. Descriptografia com o helper COMPARTILHADO, nao a copia local do index.ts.
  const token = await deps.decryptToken(account.encrypted_access_token);

  const params = new URLSearchParams({
    // `thumbnail_url` so vem preenchido para VIDEO. IMAGE traz `media_url`, e
    // CAROUSEL_ALBUM nao traz nenhum dos dois no proprio objeto -- e preciso
    // o primeiro filho, que `children{media_url}` expande na MESMA resposta
    // (sem o N+1 que o sync em index.ts faz pro carrossel). Ver fallback logo
    // abaixo, no mapeamento de `payload.data`.
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_url}",
    limit: String(limit),
    access_token: token,
  });
  if (typeof body.cursor === "string" && body.cursor) params.set("after", body.cursor);

  // 8. Prazo explicito: sem AbortSignal o handler pendura ate o runtime matar.
  const doFetch = deps.fetchImpl ?? makeBoundedFetch(deps.graphTimeoutMs ?? GRAPH_TIMEOUT_MS);
  try {
    const res = await doFetch(`https://graph.instagram.com/me/media?${params}`);
    const payload = await res.json();
    if (!res.ok || payload.error) {
      // 9. Token rejeitado: carimba o status como as rotas existentes ja fazem.
      // Espelha o mapeamento que /refresh ja usa (index.ts:886-891): 190 =
      // token expirado, 10 = permissao revogada. Sem o ramo do 10 a conta fica
      // 'active' e cada nova tentativa de re-mirar descriptografa e repete uma
      // credencial que a UI nunca sinaliza como precisando reconectar.
      const code = payload?.error?.code;
      if (code === 190) {
        await deps.svc.from("instagram_accounts").update({ authorization_status: "expired" }).eq("id", account.id);
      } else if (code === 10) {
        await deps.svc.from("instagram_accounts").update({ authorization_status: "revoked" }).eq("id", account.id);
      }
      console.error("[published-media] graph error:", payload?.error?.message ?? "unknown");
      return json({ error: true, message: "Nao foi possivel listar as midias" }, 502);
    }
    return json({
      posts: (payload.data ?? []).map((m: GraphMediaItem) => ({
        id: m.id, caption: m.caption ?? null, media_type: m.media_type,
        // VIDEO -> thumbnail_url; IMAGE -> media_url; CAROUSEL_ALBUM -> primeiro
        // filho (nem thumbnail_url nem media_url vem no objeto pai pra esse tipo).
        thumbnail_url: m.thumbnail_url ?? m.media_url ?? m.children?.data?.[0]?.media_url ?? null,
        permalink: m.permalink, timestamp: m.timestamp,
      })),
      next_cursor: payload.paging?.cursors?.after ?? null,
    });
  } catch (err) {
    // NUNCA logar `err.message` aqui. Em Deno, falha de transporte (connection
    // refused, reset, TLS, DNS) produz um erro cuja `.message` inclui a URL
    // INTEIRA da requisicao -- e essa URL carrega o access_token
    // descriptografado em claro (ver `params` acima, campo `access_token`).
    // Um `AbortSignal.timeout` nao vaza (`DOMException: "Signal timed out."`),
    // mas connection refused/reset/DNS sim. `err.name` (TypeError,
    // TimeoutError, AbortError, ...) mais esta mensagem propria ja bastam pra
    // diagnosticar em producao, sem depender de redacao por regex como unica
    // defesa contra um vazamento deste tipo.
    const kind = err instanceof Error ? err.name : typeof err;
    console.error("[published-media] fetch falhou:", kind);
    return json({ error: true, message: "Nao foi possivel listar as midias" }, 502);
  }
}
