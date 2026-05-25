import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubEditSuggestionHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

function extractR2Keys(content: any): string[] {
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === "inlineImage" && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

function stripSignedUrls(content: any): any {
  function walk(node: any): any {
    if (node?.type === "inlineImage" && node.attrs) {
      const { src: _src, ...restAttrs } = node.attrs;
      return { ...node, attrs: restAttrs };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}

function hasNewInlineImages(content: any, originalContent: any): boolean {
  const originalKeys = new Set(extractR2Keys(originalContent));
  const suggestedKeys = extractR2Keys(content);
  return suggestedKeys.some((key) => !originalKeys.has(key));
}

export function createHubEditSuggestionHandler(deps: HubEditSuggestionHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const { token, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption } = body;

    if (!token || !post_id) {
      return json({ error: "token and post_id required" }, 400);
    }
    if (suggested_conteudo_plain == null && suggested_ig_caption == null) {
      return json({ error: "No content provided" }, 400);
    }

    const db = deps.createDb();

    // Verify token
    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();

    if (!hubToken || !hubToken.is_active) {
      return json({ error: "Link inválido." }, 404);
    }

    // Verify post exists and get its workflow
    const { data: post } = await db
      .from("workflow_posts")
      .select("id, workflow_id, status, conteudo, conta_id")
      .eq("id", post_id)
      .maybeSingle();

    if (!post) return json({ error: "Post não encontrado." }, 404);

    // Verify post is in enviado_cliente status
    if (post.status !== "enviado_cliente") {
      return json({ error: "Post não está aguardando aprovação." }, 409);
    }

    // Verify ownership: post's workflow belongs to this client
    const { data: workflow } = await db
      .from("workflows")
      .select("cliente_id")
      .eq("id", post.workflow_id)
      .single();

    if (workflow?.cliente_id !== hubToken.cliente_id) {
      return json({ error: "Não autorizado." }, 403);
    }

    // Sanitize TipTap JSON: reject new inline images, strip signed URLs
    let sanitizedConteudo = suggested_conteudo;
    if (sanitizedConteudo) {
      if (hasNewInlineImages(sanitizedConteudo, post.conteudo)) {
        return json({ error: "Não é permitido adicionar imagens." }, 400);
      }

      const suggestedKeys = extractR2Keys(sanitizedConteudo);
      if (suggestedKeys.length > 0) {
        const contaPrefix = `contas/${post.conta_id}/`;
        const invalidKey = suggestedKeys.find((k: string) => !k.startsWith(contaPrefix));
        if (invalidKey) {
          return json({ error: "Referência de mídia inválida." }, 400);
        }
      }

      sanitizedConteudo = stripSignedUrls(sanitizedConteudo);
    }

    // Call the upsert RPC
    const { data: result, error: rpcError } = await db.rpc("upsert_edit_suggestion", {
      p_post_id: post_id,
      p_conta_id: post.conta_id,
      p_token: token,
      p_suggested_conteudo: sanitizedConteudo ?? null,
      p_suggested_conteudo_plain: suggested_conteudo_plain ?? null,
      p_suggested_ig_caption: suggested_ig_caption ?? null,
    });

    if (rpcError) {
      console.error("[hub-edit-suggestion] upsert failed:", rpcError);
      return json({ error: "Erro ao salvar sugestão." }, 500);
    }

    const rpcResult = result as { action: string; is_new: boolean; suggestion: unknown };

    // Create notification only on first insert
    if (rpcResult.is_new) {
      const { error: notifErr } = await db.rpc("create_edit_suggestion_notification", {
        p_post_id: post_id,
      });
      if (notifErr) {
        console.error("[hub-edit-suggestion] notification creation failed:", notifErr);
      }
    }

    return json({
      ok: true,
      pending_suggestion: rpcResult.suggestion ?? null,
    });
  };
}
