// MCP media tools: presigned upload (create_media_upload) + set-post-media (set_post_media). Mirrors the
// web UI's file-upload-url → PUT → finalize flow; all DB mutation for set lives in the
// post_media_set_from_uploads RPC. Own-auth via MCP key scopes (posts:write).
import { McpInputError } from "../_shared/mcp-token.ts";
import { getPost, type Deps } from "./queries.ts";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export async function createMediaUpload(
  d: Deps,
  args: { files: Array<{ filename: string; mime_type: string; size_bytes: number }> },
): Promise<{ uploads: Array<{ r2_key: string; upload_url: string; mime_type: string; size_bytes: number }> }> {
  // Quota precheck BEFORE signing (mirror file-upload-url:90) — no orphan object on overage.
  const total = args.files.reduce((s, f) => s + f.size_bytes, 0);
  const quota = d.storageQuota ? await d.storageQuota(d.ctx.conta_id) : null;
  const { data: ws } = await d.db.from("workspaces").select("storage_used_bytes").eq("id", d.ctx.conta_id).single();
  const used = Number((ws as { storage_used_bytes?: number } | null)?.storage_used_bytes ?? 0);
  if (quota !== null && used + total > quota) {
    throw new McpInputError("Cota de armazenamento excedida — libere espaço em Arquivos.");
  }
  const uploads = [];
  for (const f of args.files) {
    const ext = EXT[f.mime_type] ?? "bin";
    const uuid = d.randomUUID ? d.randomUUID() : crypto.randomUUID();
    const r2_key = `contas/${d.ctx.conta_id}/files/${uuid}.${ext}`;
    const upload_url = await d.signPutUrl!(r2_key, f.mime_type);
    uploads.push({ r2_key, upload_url, mime_type: f.mime_type, size_bytes: f.size_bytes });
  }
  return { uploads };
}

function mapSetMediaError(message: string): McpInputError {
  if (message === "post_not_found") return new McpInputError("Post não encontrado neste workspace.");
  if (message.startsWith("post_not_editable:")) {
    return new McpInputError(`Post em estado '${message.slice("post_not_editable:".length)}' não pode receber mídia pelo agente.`);
  }
  if (message.startsWith("tipo_not_image:")) {
    return new McpInputError(`Posts do tipo '${message.slice("tipo_not_image:".length)}' não recebem imagens (suportados: feed, carrossel).`);
  }
  if (message === "design_attached") {
    return new McpInputError("A mídia deste post é gerida por um design — edite o design com update_design.");
  }
  if (message === "quota_exceeded") return new McpInputError("Cota de armazenamento excedida.");
  return new McpInputError("Não foi possível definir a mídia do post.");
}

export async function setPostMedia(
  d: Deps,
  args: {
    post_id: number;
    items: Array<{ r2_key: string; size_bytes: number; mime_type: string; width?: number; height?: number; filename?: string }>;
  },
): Promise<unknown> {
  // Integrity precheck (TS — R2 is outside the DB). All eligibility/mutation is in the RPC.
  const prefix = `contas/${d.ctx.conta_id}/files/`;
  for (const it of args.items) {
    if (!it.r2_key.startsWith(prefix)) {
      throw new McpInputError("Upload não encontrado ou divergente. Gere os uploads com create_media_upload.");
    }
    const head = d.headObject ? await d.headObject(it.r2_key) : null;
    if (!head || head.contentLength !== it.size_bytes ||
        (head.contentType && it.mime_type && head.contentType !== it.mime_type)) {
      throw new McpInputError("Upload não encontrado ou divergente. Gere os uploads com create_media_upload.");
    }
  }
  // RETURNS jsonb (scalar) → { data, error } directly (no .single()); we ignore data and re-read
  // via getPost so the agent gets the full ordered media back.
  const { error } = await d.db.rpc("post_media_set_from_uploads", {
    p_conta_id: d.ctx.conta_id, p_post_id: args.post_id, p_uploaded_by: d.ctx.created_by, p_items: args.items,
  });
  if (error) throw mapSetMediaError((error as { message?: string }).message ?? "");
  return await getPost(d, { post_id: args.post_id });
}
