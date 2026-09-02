// supabase/functions/equipe-chat-media/handler.ts
// Anexos do chat de equipe: presign tmp -> PUT direto no R2 -> finalize
// (HEAD confere o objeto REAL, copia tmp->final, RPC reserva quota
// atomicamente) -> GET assinado por anexo_id.
// Spec: docs/superpowers/specs/2026-09-02-team-group-chats-design.md
import { createJsonResponder } from "../_shared/http.ts";
import { assertPlanFeature, FeatureDisabledError } from "../_shared/entitlements.ts";

// Allowlist de chat: imagens comuns + documentos (subset da file-upload-url).
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
};
export const MAX_ANEXO_BYTES = 25 * 1024 * 1024;
const SIGNED_GET_TTL = 600; // 10 min

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  copyObject: (sourceKey: string, destKey: string) => Promise<void>;
  trashObject: (key: string) => Promise<void>;
  randomUUID?: () => string;
}

export function createEquipeChatMediaHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Not found" }, 404);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Tenant = workspace ATIVA + membership confirmada (padrao report-docs;
    // conta_id legado NAO e fallback).
    const { data: profile } = await svc.from("profiles")
      .select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc.from("workspace_members")
      .select("user_id, role").eq("workspace_id", contaId).eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    // Fail-closed: no plan resolved (e.g. workspace with no default plan
    // seeded) must block, not bypass. assertPlanFeature throws whenever
    // `!ent || ent.features[flag] !== true`, unlike the old inline
    // `ent && ...` check, which skipped the gate entirely (fail-open) if
    // resolveEntitlements ever returned null.
    try {
      await assertPlanFeature(svc as never, contaId, "feature_team_chat");
    } catch (e) {
      if (e instanceof FeatureDisabledError) {
        return json({ error: "feature_disabled", feature: "feature_team_chat" }, 403);
      }
      throw e;
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("equipe-chat-media");
    const route = idx >= 0 ? parts[idx + 1] : undefined;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const tmpPrefix = `equipe-chat-tmp/${contaId}/`;
    const finalPrefix = `equipe-chat/${contaId}/`;

    async function isParticipant(conversaId: number): Promise<boolean> {
      const { data: conversa } = await svc.from("equipe_conversas")
        .select("conta_id").eq("id", conversaId).maybeSingle();
      if (!conversa || conversa.conta_id !== contaId) return false;
      const { data: pt } = await svc.from("equipe_conversa_participantes")
        .select("id").eq("conversa_id", conversaId).eq("user_id", user!.id)
        .maybeSingle();
      return !!pt;
    }

    try {
      if (route === "presign") {
        const conversaId = Number(body.conversa_id);
        const mime = String(body.mime_type ?? "");
        const size = Number(body.size_bytes);
        if (!Number.isInteger(conversaId)) return json({ error: "conversa_id invalido" }, 400);
        if (!(mime in MIME_EXT)) return json({ error: "unsupported file type" }, 415);
        if (!size || size <= 0 || size > MAX_ANEXO_BYTES) {
          return json({ error: "size_bytes out of range" }, 400);
        }
        if (!(await isParticipant(conversaId))) return json({ error: "Forbidden" }, 403);
        const uuid = (deps.randomUUID ?? crypto.randomUUID.bind(crypto))();
        const key = `${tmpPrefix}${uuid}.${MIME_EXT[mime]}`;
        const upload_url = await deps.signPutUrl(key, mime);
        return json({ upload_url, key }, 200);
      }

      if (route === "finalize") {
        const conversaId = Number(body.conversa_id);
        const key = String(body.key ?? "");
        const mime = String(body.mime_type ?? "");
        const size = Number(body.size_bytes);
        // O PUT pre-assinado nao restringe Content-Length: sem isto, um
        // participante presigna com size_bytes pequeno e sobe um objeto
        // maior, e finalize (que so confere head.contentLength === o size
        // AUTO-DECLARADO aqui) aceitaria e cobraria quota com qualquer
        // tamanho. Mesmo teto do presign, re-checado aqui.
        if (!size || size <= 0 || size > MAX_ANEXO_BYTES) {
          return json({ error: "size_bytes out of range" }, 400);
        }
        const fileName = String(body.file_name ?? "").slice(0, 200);
        if (!Number.isInteger(conversaId)) return json({ error: "conversa_id invalido" }, 400);
        if (!key.startsWith(tmpPrefix)) return json({ error: "invalid key" }, 400);
        if (!(mime in MIME_EXT)) return json({ error: "unsupported file type" }, 415);
        if (!fileName) return json({ error: "file_name obrigatorio" }, 400);
        if (!(await isParticipant(conversaId))) return json({ error: "Forbidden" }, 403);

        // Hoisted acima do HEAD: precisa dela tanto para o lookup idempotente
        // abaixo quanto para a copia tmp->final mais adiante.
        const finalKey = finalPrefix + key.slice(tmpPrefix.length);

        // Retry apos resposta perdida: o sucesso ja trasheia a tmp (abaixo),
        // entao um retry com a MESMA key morreria aqui no headObject(tmp) --
        // 400 "object not found" -- sem nunca alcancar o caminho idempotente
        // da RPC (que so roda de novo se chegar la). Espelha o fast path da
        // propria equipe_chat_anexo_finalize (SELECT ... WHERE r2_key =
        // v_key), agora alcancavel mesmo com a tmp ja sumida -- sem tocar R2
        // ou a RPC de novo.
        const { data: existing } = await svc.from("equipe_mensagem_anexos")
          .select("id, file_name, mime_type, size_bytes, conversa_id, conta_id")
          .eq("r2_key", finalKey).maybeSingle();
        if (existing) {
          if (existing.conta_id === contaId && existing.conversa_id === conversaId) {
            return json({
              anexo: {
                id: existing.id,
                file_name: existing.file_name,
                mime_type: existing.mime_type,
                size_bytes: existing.size_bytes,
              },
            }, 200);
          }
          // Nao deveria acontecer (finalKey e derivada do prefixo do tenant
          // ja validado), mas nao confirma a existencia de um anexo de outro
          // tenant/conversa.
          return json({ error: "Not found" }, 404);
        }

        const head = await deps.headObject(key);
        if (!head) return json({ error: "object not found" }, 400);
        if (head.contentLength !== size) return json({ error: "size mismatch" }, 400);
        if (head.contentType && head.contentType !== mime) {
          return json({ error: "content-type mismatch" }, 400);
        }

        // tmp -> final: a URL PUT ainda valida so alcanca a tmp, nunca o
        // objeto contabilizado.
        await deps.copyObject(key, finalKey);

        const { data: row, error: rpcErr } = await svc
          .rpc("equipe_chat_anexo_finalize", {
            p: {
              conta_id: contaId,
              conversa_id: conversaId,
              created_by: user.id,
              r2_key: finalKey,
              file_name: fileName,
              mime_type: mime,
              size_bytes: size,
            },
          })
          .single();
        if (rpcErr) {
          const msg = (rpcErr as { message?: string }).message ?? "";
          // Falhou depois da copia: tenta desfazer a final para nao vazar.
          await deps.trashObject(finalKey).catch(() => {});
          if (msg.includes("quota_exceeded")) return json({ error: "quota_exceeded" }, 413);
          if (msg.includes("conversa_not_found")) return json({ error: "Forbidden" }, 403);
          if (msg.includes("invalid_key") || msg.includes("invalid_size")) {
            return json({ error: "invalid request" }, 400);
          }
          console.error("equipe-chat-media finalize rpc:", msg);
          return json({ error: "internal error" }, 500);
        }
        await deps.trashObject(key).catch(() => {});
        return json({
          anexo: {
            id: row.anexo_id,
            file_name: row.file_name,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
          },
        }, 200);
      }

      if (route === "anexo-url") {
        const anexoId = Number(body.anexo_id);
        if (!Number.isInteger(anexoId)) return json({ error: "anexo_id invalido" }, 400);
        const { data: anexo } = await svc.from("equipe_mensagem_anexos")
          .select("id, conta_id, conversa_id, mensagem_id, r2_key, created_by")
          .eq("id", anexoId).maybeSingle();
        if (!anexo || anexo.conta_id !== contaId) return json({ error: "Not found" }, 404);
        const { data: pt } = await svc.from("equipe_conversa_participantes")
          .select("id").eq("conversa_id", anexo.conversa_id).eq("user_id", user.id)
          .maybeSingle();
        // 404, nao 403: um membro do workspace que nao participa da
        // conversa nao deve conseguir confirmar que o anexo_id existe.
        if (!pt) return json({ error: "Not found" }, 404);
        // Staged (mensagem_id NULL) = rascunho ainda nao enviado: so o autor
        // pode ver. Um participante que nao e o autor recebe o mesmo 404 de
        // "nao existe" (sem oraculo de existencia) -- uma vez enviado
        // (mensagem_id preenchido), qualquer participante pode ver.
        if (anexo.mensagem_id === null && anexo.created_by !== user.id) {
          return json({ error: "Not found" }, 404);
        }
        const signed = await deps.signGetUrl(anexo.r2_key, SIGNED_GET_TTL);
        return json({ url: signed }, 200);
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error("equipe-chat-media:", (e as Error).message);
      return json({ error: "internal error" }, 500);
    }
  };
}
