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

export type Deps = {
  svc: Svc;
  userId: string;
  corsHeaders: Record<string, string>;
  decryptToken: (encryptedBase64: string) => Promise<string>;
  verifyClientOwnership: (svc: Svc, clientId: string, contaId: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
};

export type PublishedMediaItem = {
  id: string;
  caption: string | null;
  media_type: string;
  thumbnail_url: string | null;
  permalink: string;
  timestamp: string;
};

const GRAPH_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

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

  // 5. Conta e status.
  const { data: account } = await deps.svc.from("instagram_accounts")
    .select("id, encrypted_access_token, authorization_status").eq("client_id", clientId).single();
  if (!account) return json({ error: true, message: "Not found" }, 404);
  if (account.authorization_status !== "active") {
    return json({ error: true, code: "instagram_not_authorized", message: "Conta do Instagram nao autorizada" }, 409);
  }

  // 6. Descriptografia com o helper COMPARTILHADO, nao a copia local do index.ts.
  const token = await deps.decryptToken(account.encrypted_access_token);

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const params = new URLSearchParams({
    fields: "id,caption,media_type,thumbnail_url,permalink,timestamp",
    limit: String(limit),
    access_token: token,
  });
  if (typeof body.cursor === "string" && body.cursor) params.set("after", body.cursor);

  // 7. Prazo explicito: sem AbortSignal o handler pendura ate o runtime matar.
  const doFetch = deps.fetchImpl ?? makeBoundedFetch(GRAPH_TIMEOUT_MS);
  try {
    const res = await doFetch(`https://graph.instagram.com/me/media?${params}`);
    const payload = await res.json();
    if (!res.ok || payload.error) {
      // 8. Token rejeitado: carimba o status como as rotas existentes ja fazem.
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
      posts: (payload.data ?? []).map((m: Record<string, string>) => ({
        id: m.id, caption: m.caption ?? null, media_type: m.media_type,
        thumbnail_url: m.thumbnail_url ?? null, permalink: m.permalink, timestamp: m.timestamp,
      })),
      next_cursor: payload.paging?.cursors?.after ?? null,
    });
  } catch (err) {
    console.error("[published-media] fetch falhou:", err instanceof Error ? err.message : String(err));
    return json({ error: true, message: "Nao foi possivel listar as midias" }, 502);
  }
}
