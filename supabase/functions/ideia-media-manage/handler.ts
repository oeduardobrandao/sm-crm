import { createJsonResponder } from "../_shared/http.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";
import {
  presignIdeiaImage, finalizeIdeiaImage, listIdeiaImages, removeIdeiaImage,
} from "../_shared/ideia-media.ts";
import {
  finalizeIdeiaAudio, loadIdeiaAudioView, presignIdeiaAudio, removeIdeiaAudio, transcribeIdeiaAudio,
  type Transcriber,
} from "../_shared/ideia-audio.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const RESERVED = new Set(["upload-url", "audio-upload-url", "audio"]);

export function createIdeiaMediaManageHandler(deps: Deps) {
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("ideia-media-manage");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const ideiaId = seg[0] && !RESERVED.has(seg[0]) ? seg[0] : null;
    const isAudioPresign = seg.length === 1 && seg[0] === "audio-upload-url";
    const isAudioView = req.method === "GET" && seg.length === 1 && seg[0] === "audio";
    const isAudio = !!ideiaId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!ideiaId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";
    const scope = { db: db as any, workspace_id: conta_id, origem: "agencia" as const };

    // ── Áudio ──────────────────────────────────────────────────────
    // 'ideias:ver'/'ideias:editar' checam o papel do chamador -- sem isso um
    // membro com papel custom SEM ideias nenhum ainda mintaria URL assinada
    // de áudio (view) ou faria presign/finalize/retry/delete (mutação)
    // batendo direto na function, ignorando o gate de UI do CRM. Mesmo
    // racional do sign-view/mutatingRoutes em automation-media/handler.ts.
    if (isAudioView) {
      const canView = await hasPermissionFor(db, user.id, conta_id, "ideias", "ver");
      if (!canView) return json({ error: "Forbidden" }, 403);
      const qid = url.searchParams.get("ideia_id");
      if (!qid) return json({ error: "ideia_id required" }, 400);
      const v = await loadIdeiaAudioView({ db: db as any, workspace_id: conta_id, ideia_id: qid, signGetUrl: signGet });
      if (!v) return json({ error: "Ideia não encontrada." }, 404);
      return json(v);
    }

    if (isAudioPresign || isAudio || isTranscribe) {
      const canEdit = await hasPermissionFor(db, user.id, conta_id, "ideias", "editar");
      if (!canEdit) return json({ error: "Forbidden" }, 403);
      if (req.method === "POST") {
        const audioOn = await effectivePlanFeature(db as never, conta_id, "feature_briefing_audio");
        if (!audioOn) return json({ error: "Recurso indisponível no plano atual." }, 403);
      } else if (!(req.method === "DELETE" && isAudio)) {
        return json({ error: "Method not allowed" }, 405);
      }
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

      if (isAudioPresign) {
        const ideia_id = typeof body.ideia_id === "string" ? body.ideia_id : "";
        if (!ideia_id || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "ideia_id, mime_type and size_bytes are required" }, 400);
        }
        const r = await presignIdeiaAudio({
          ...scope, ideia_id, mime_type: body.mime_type, size_bytes: body.size_bytes,
          signPutUrl: deps.signPutUrl, randomUUID: deps.randomUUID,
        });
        return json(r.body, r.status);
      }
      if (isAudio && req.method === "POST") {
        if (typeof body.r2_key !== "string" || typeof body.mime_type !== "string" || typeof body.size_bytes !== "number") {
          return json({ error: "r2_key, mime_type and size_bytes are required" }, 400);
        }
        const r = await finalizeIdeiaAudio({
          ...scope, ideia_id: ideiaId!,
          r2_key: body.r2_key, mime_type: body.mime_type, size_bytes: body.size_bytes,
          duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
          headObject: deps.headObject, signGetUrl: signGet, transcribe: deps.transcribe,
        });
        return json(r.body, r.status);
      }
      if (isAudio && req.method === "DELETE") {
        const r = await removeIdeiaAudio({ ...scope, ideia_id: ideiaId! });
        return json(r.body, r.status);
      }
      const r = await transcribeIdeiaAudio({ ...scope, ideia_id: ideiaId!, signGetUrl: signGet, transcribe: deps.transcribe });
      return json(r.body, r.status);
    }

    // ── Imagens ────────────────────────────────────────────────────
    // Mesmo racional do bloco de Áudio: ideias:ver no GET, ideias:editar nas mutações.
    const isImageUploadUrl = req.method === "POST" && seg[0] === "upload-url";
    const isImageFinalize = req.method === "POST" && !!ideiaId && seg[1] === "files";
    const isImageDelete = req.method === "DELETE" && !!ideiaId && seg[1] === "files" && !!seg[2];
    if (req.method === "GET") {
      const canView = await hasPermissionFor(db, user.id, conta_id, "ideias", "ver");
      if (!canView) return json({ error: "Forbidden" }, 403);
    } else if (isImageUploadUrl || isImageFinalize || isImageDelete) {
      const canEdit = await hasPermissionFor(db, user.id, conta_id, "ideias", "editar");
      if (!canEdit) return json({ error: "Forbidden" }, 403);
    }

    // GET ?ideia_id= -> list
    if (req.method === "GET") {
      const qid = url.searchParams.get("ideia_id");
      if (!qid) return json({ error: "ideia_id required" }, 400);
      const r = await listIdeiaImages({
        db: db as any, conta_id, cliente_id: null, ideia_id: qid, signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // POST /upload-url -> presign
    if (isImageUploadUrl) {
      const body = await req.json().catch(() => ({}));
      const r = await presignIdeiaImage({
        db: db as any, conta_id, cliente_id: null,
        ideia_id: String(body.ideia_id ?? ""),
        filename: String(body.filename ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail: {
          mime_type: String(body.thumbnail?.mime_type ?? ""),
          size_bytes: Number(body.thumbnail?.size_bytes ?? 0),
        },
        signPutUrl: deps.signPutUrl,
      });
      return json(r.body, r.status);
    }

    // POST /:id/files -> finalize
    if (isImageFinalize) {
      const body = await req.json().catch(() => ({}));
      const r = await finalizeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId!,
        r2_key: String(body.r2_key ?? ""),
        thumbnail_r2_key: String(body.thumbnail_r2_key ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail_bytes: Number(body.thumbnail_bytes ?? 0),
        name: String(body.name ?? "image"),
        width: body.width != null ? Number(body.width) : undefined,
        height: body.height != null ? Number(body.height) : undefined,
        blur_data_url: typeof body.blur_data_url === "string" ? body.blur_data_url : undefined,
        sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
        uploaded_by: user.id,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // DELETE /:id/files/:fileId -> remove
    if (isImageDelete) {
      const fileId = Number(seg[2]);
      if (Number.isNaN(fileId)) return json({ error: "invalid file id" }, 400);
      const r = await removeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId!, file_id: fileId,
      });
      return json(r.body, r.status);
    }

    return json({ error: "Not found" }, 404);
  };
}
