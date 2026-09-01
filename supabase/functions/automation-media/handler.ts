// supabase/functions/automation-media/handler.ts
// Upload/ciclo de vida da mídia do cartão de DM das automações.
// Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
// Contrato de upload: presign -> PUT direto no R2 -> finalize (HEAD confere o
// objeto REAL + reserva quota atômica). delete: trashObject (undo 30d) +
// liberação de quota. Nada aqui grava dm_media na automação: quem grava é o
// CRM via PostgREST, e o CHECK de tenant do banco é o enforcement final.

const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // limite de imagem da Meta
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

export interface AutomationMediaDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  // deno-lint-ignore no-explicit-any
  createDb: () => any;
  signPutUrl: (key: string, mimeType: string) => Promise<string>;
  signGetUrl: (key: string) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  trashObject: (key: string) => Promise<void>;
  copyObject: (sourceKey: string, destKey: string) => Promise<void>;
  randomUUID?: () => string;
}

export function createAutomationMediaHandler(deps: AutomationMediaDeps) {
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), {
        status: s,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    // Tenant = workspace ATIVA + membership confirmada, padrão do report-docs
    // (conta_id NÃO é fallback: usuário multi-workspace operaria na workspace
    // errada, e membro removido manteria acesso).
    const { data: profile } = await svc.from("profiles").select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", contaId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);
    const tenantPrefix = `automation-media/${contaId}/`;

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const route = parts[parts.indexOf("automation-media") + 1];

    // deno-lint-ignore no-explicit-any
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (route === "presign") {
      const mime = String(body.mime_type ?? "");
      const size = Number(body.size_bytes ?? 0);
      if (!(mime in ALLOWED_MIME)) return json({ error: "unsupported file type" }, 415);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
        return json({ error: "invalid size" }, 400);
      }
      // Upload SEMPRE no prefixo tmp. A key FINAL (a única que dm_media
      // aceita) nunca recebe PUT pré-assinado: o finalize copia tmp -> final,
      // então sobrescrever a tmp depois (a URL vive 15 min) não alcança o
      // objeto contabilizado/servido. Tmp abandonada é órfã aceita.
      const key = `automation-media-tmp/${contaId}/${randomUUID()}.${ALLOWED_MIME[mime]}`;
      const upload_url = await deps.signPutUrl(key, mime);
      return json({ upload_url, key });
    }

    if (route === "finalize") {
      const tmpKey = String(body.key ?? "");
      const mime = String(body.mime_type ?? "");
      const size = Number(body.size_bytes ?? 0);
      const tmpPrefix = `automation-media-tmp/${contaId}/`;
      if (!tmpKey.startsWith(tmpPrefix)) return json({ error: "invalid key" }, 400);
      if (!(mime in ALLOWED_MIME)) return json({ error: "unsupported file type" }, 415);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
        return json({ error: "invalid size" }, 400);
      }
      const key = `${tenantPrefix}${tmpKey.slice(tmpPrefix.length)}`;
      // Retry idempotente: se a resposta do finalize anterior se perdeu, a key
      // final JÁ tem registro -- devolve o canônico sem recopiar (recopiar a
      // tmp, que pode ter sido sobrescrita pela URL de PUT ainda válida,
      // corromperia a final já verificada).
      const { data: existing } = await svc
        .from("automation_media_objects")
        .select("key, content_type, size_bytes")
        .eq("key", key)
        .eq("conta_id", contaId)
        .maybeSingle();
      if (existing?.key) {
        const w = Number.isFinite(Number(body.width)) && Number(body.width) > 0 ? Number(body.width) : undefined;
        const h = Number.isFinite(Number(body.height)) && Number(body.height) > 0 ? Number(body.height) : undefined;
        return json({
          dm_media: {
            key: existing.key,
            content_type: existing.content_type,
            size_bytes: existing.size_bytes,
            ...(w ? { width: w } : {}),
            ...(h ? { height: h } : {}),
          },
        });
      }
      // Valida a TMP antes de copiar (falha barata, nada chega ao prefixo
      // permanente) e revalida a FINAL depois (a URL de PUT da tmp segue viva:
      // uma sobrescrita entre o HEAD e a cópia não pode sobreviver). Qualquer
      // falha PÓS-cópia trasheia a final -- sem isso, requests repetidos com
      // mismatch acumulariam objetos não medidos fora da quota.
      const tmpHead = await deps.headObject(tmpKey);
      if (!tmpHead) return json({ error: "object not found" }, 400);
      if (tmpHead.contentLength !== size) return json({ error: "size mismatch" }, 400);
      if (tmpHead.contentType && tmpHead.contentType !== mime) {
        return json({ error: "content-type mismatch" }, 400);
      }
      try {
        await deps.copyObject(tmpKey, key);
      } catch (e) {
        console.error("[automation-media] copy tmp->final:", e instanceof Error ? e.message : String(e));
        return json({ error: "object not found" }, 400);
      }
      const failFinal = async (err: string) => {
        await deps.trashObject(key).catch(() => {});
        return json({ error: err }, 400);
      };
      const head = await deps.headObject(key);
      if (!head) return await failFinal("object not found");
      if (head.contentLength !== size) return await failFinal("size mismatch");
      if (head.contentType && head.contentType !== mime) return await failFinal("content-type mismatch");

      const { error: rpcErr } = await svc.rpc("automation_media_finalize", {
        p_conta_id: contaId,
        p_key: key,
        p_bytes: size,
        p_content_type: mime,
      });
      if (rpcErr) {
        const msg = String(rpcErr.message ?? "");
        if (msg.includes("quota_exceeded")) {
          // Não deixa o upload rejeitado retido fora da contabilidade.
          await deps.trashObject(key).catch((e) =>
            console.error("[automation-media] trash pós-quota:", e instanceof Error ? e.message : String(e))
          );
          return json({ error: "quota_exceeded" }, 413);
        }
        console.error("[automation-media] finalize:", msg);
        return json({ error: "internal" }, 500);
      }
      // Tmp cumpriu o papel; trash best-effort (falha vira órfã tmp, aceita).
      await deps.trashObject(tmpKey).catch(() => {});
      const width = Number.isFinite(Number(body.width)) && Number(body.width) > 0 ? Number(body.width) : undefined;
      const height = Number.isFinite(Number(body.height)) && Number(body.height) > 0 ? Number(body.height) : undefined;
      return json({
        dm_media: {
          key,
          content_type: mime,
          size_bytes: size,
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        },
      });
    }

    if (route === "sign-view") {
      const key = String(body.key ?? "");
      if (!key.startsWith(tenantPrefix)) return json({ error: "invalid key" }, 400);
      return json({ url: await deps.signGetUrl(key) });
    }

    if (route === "delete") {
      const key = String(body.key ?? "");
      if (!key.startsWith(tenantPrefix)) return json({ error: "invalid key" }, 400);
      // Pre-check de aplicação: falha rápido com 409 sem tocar o R2 quando a
      // key ainda está referenciada. A RPC abaixo faz o ref-check
      // anti-corrida DE VERDADE (na mesma transação do DELETE, com FOR KEY
      // SHARE do lado do attach) -- este SELECT aqui é só o caminho feliz
      // mais barato, não substitui a garantia atômica da RPC.
      const { data: refs } = await svc
        .from("instagram_comment_automations")
        .select("id")
        .eq("dm_media->>key", key);
      if (Array.isArray(refs) && refs.length > 0) return json({ error: "media_in_use" }, 409);
      // ORDEM: release ANTES do trash. A RPC faz, na mesma transação, o
      // ref-check anti-corrida (media_in_use se alguma automação referencia)
      // e remove o registro -- a partir daí nenhum attach novo passa no
      // trigger, então o trash abaixo nunca apaga objeto referenciado. Os
      // bytes liberados vêm do registro do servidor, nunca do request.
      const { error: rpcErr } = await svc.rpc("automation_media_release", {
        p_conta_id: contaId,
        p_key: key,
      });
      if (rpcErr) {
        const msg = String(rpcErr.message ?? "");
        if (msg.includes("media_in_use")) return json({ error: "media_in_use" }, 409);
        console.error("[automation-media] release:", msg);
        return json({ error: "internal" }, 500);
      }
      try {
        await deps.trashObject(key);
      } catch (e) {
        // Registro já liberado; objeto vira órfão não contabilizado (aceito,
        // reap futuro). Retry do cliente: release devolve 0 e re-trasheia.
        console.error("[automation-media] trashObject:", e instanceof Error ? e.message : String(e));
        return json({ error: "internal" }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  };
}
