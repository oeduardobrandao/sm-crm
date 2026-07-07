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
