import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import {
  type ClientScopeLoader,
  loadClientScope as realLoadClientScope,
} from "../_shared/client-scope.ts";
import { folderClienteId, itemVisible } from "../_shared/file-client-scope.ts";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface FileUploadUrlDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mimeType: string, sizeBytes: number) => Promise<string>;
  randomUUID?: () => string;
  /** Acesso por cliente: the caller's client scope (defaults to the real loader). */
  loadClientScope?: ClientScopeLoader;
}

const MAX_SIZE = 400 * 1024 * 1024;
// Vídeos sobem por PUT presignado direto no R2 (limite de 5 GiB por PUT).
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "application/pdf": "pdf", "application/zip": "zip",
  };
  return map[mime] ?? "bin";
}

function classifyKind(mime: string): "image" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function createFileUploadUrlHandler(deps: FileUploadUrlDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const svc = deps.createDb();
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

    let body: {
      folder_id?: number | null;
      filename: string;
      mime_type: string;
      size_bytes: number;
      thumbnail?: { mime_type: string; size_bytes: number };
    };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const { folder_id, filename, mime_type, size_bytes, thumbnail } = body;
    if (!filename || !mime_type || !size_bytes) return json({ error: "Missing fields" }, 400);
    const kind = classifyKind(mime_type);
    const maxSize = kind === "video" ? MAX_VIDEO_SIZE : MAX_SIZE;

    // Inteiros: viram Content-Length assinado nas URLs de upload.
    if (!Number.isSafeInteger(size_bytes) || size_bytes <= 0 || size_bytes > maxSize) {
      return json({ error: "size_bytes out of range" }, 400);
    }

    const MIME_ALLOWLIST: Record<string, string[]> = {
      image: ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
      video: ["video/mp4", "video/quicktime", "video/webm"],
      document: ["application/pdf", "application/zip"],
    };
    if (!MIME_ALLOWLIST[kind]?.includes(mime_type)) {
      return json({ error: "unsupported file type" }, 415);
    }

    if (kind === "video" && !thumbnail) return json({ error: "video requires thumbnail" }, 400);
    if (thumbnail) {
      if (typeof thumbnail.mime_type !== "string" || !thumbnail.mime_type.startsWith("image/")) {
        return json({ error: "thumbnail must be an image" }, 400);
      }
      if (
        !Number.isSafeInteger(thumbnail.size_bytes) || thumbnail.size_bytes <= 0 ||
        thumbnail.size_bytes > 10 * 1024 * 1024
      ) {
        return json({ error: "thumbnail size out of range" }, 400);
      }
    }

    if (folder_id) {
      const { data: folder } = await svc.from("folders").select("conta_id").eq("id", folder_id).single();
      if (!folder || folder.conta_id !== profile.conta_id) return json({ error: "Folder not found" }, 404);
    }
    // Acesso por cliente: uploading into a hidden client's folder answers like a missing folder.
    // A workspace-level folder stays writable. A scope read error is a generic 500.
    if (folder_id) {
      try {
        const scope = await (deps.loadClientScope ?? realLoadClientScope)(svc, user.id, profile.conta_id);
        if (!scope.all && !itemVisible(scope, await folderClienteId(svc as any, Number(folder_id), profile.conta_id))) {
          return json({ error: "Folder not found" }, 404);
        }
      } catch (err) {
        return internalServerError(json, "file-upload-url:client-scope", err);
      }
    }

    const { data: ws } = await svc.from("workspaces")
      .select("storage_used_bytes").eq("id", profile.conta_id).single();
    const quota = await effectivePlanLimit(svc as any, profile.conta_id, "storage_quota_bytes"); // null=unlimited
    if (quota !== null) {
      const used = Number(ws?.storage_used_bytes ?? 0);
      const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
      if (used + needed > quota) {
        return json({ error: "quota_exceeded", used, quota }, 413);
      }
    }

    const fileId = (deps.randomUUID ?? crypto.randomUUID.bind(crypto))();
    const ext = extFromMime(mime_type);
    const r2_key = `contas/${profile.conta_id}/files/${fileId}.${ext}`;
    const upload_url = await deps.signPutUrl(r2_key, mime_type, size_bytes);

    let thumbnail_r2_key: string | undefined;
    let thumbnail_upload_url: string | undefined;
    if (thumbnail) {
      thumbnail_r2_key = `contas/${profile.conta_id}/files/${fileId}.thumb.${extFromMime(thumbnail.mime_type)}`;
      thumbnail_upload_url = await deps.signPutUrl(thumbnail_r2_key, thumbnail.mime_type, thumbnail.size_bytes);
    }

    return json({
      file_id: fileId, upload_url, r2_key, kind,
      thumbnail_upload_url, thumbnail_r2_key,
    });
  };
}
