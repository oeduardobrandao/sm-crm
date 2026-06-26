import { effectivePlanLimit } from "./entitlements-rpc.ts";

export const IDEIA_IMAGE_MIME = [
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 26214400
export const MAX_THUMB_BYTES = 512 * 1024;       // 524288
export const MAX_IMAGES_PER_IDEIA = 10;

export type IdeiaMediaResult = { status: number; body: Record<string, unknown> };

export type IdeiaMediaDb = {
  from: (table: string) => any;
  rpc: (name: string, params: Record<string, unknown>) => any;
};

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif",
  };
  return map[mime] ?? "bin";
}

export interface PresignArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail: { mime_type: string; size_bytes: number };
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}

export async function presignIdeiaImage(a: PresignArgs): Promise<IdeiaMediaResult> {
  if (!IDEIA_IMAGE_MIME.includes(a.mime_type)) {
    return { status: 415, body: { error: "unsupported file type" } };
  }
  if (!a.size_bytes || a.size_bytes <= 0 || a.size_bytes > MAX_IMAGE_BYTES) {
    return { status: 400, body: { error: "size_bytes out of range" } };
  }
  if (a.thumbnail?.mime_type !== "image/webp") {
    return { status: 400, body: { error: "thumbnail must be image/webp" } };
  }
  if (!a.thumbnail.size_bytes || a.thumbnail.size_bytes <= 0 || a.thumbnail.size_bytes > MAX_THUMB_BYTES) {
    return { status: 400, body: { error: "thumbnail size out of range" } };
  }

  // Best-effort early cap check (authoritative check is in the RPC at finalize).
  const { count } = await a.db.from("ideia_files")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", a.ideia_id);
  if ((count ?? 0) >= MAX_IMAGES_PER_IDEIA) {
    return { status: 409, body: { error: "image_limit" } };
  }

  // Best-effort early quota check.
  const { data: ws } = await a.db.from("workspaces")
    .select("storage_used_bytes").eq("id", a.conta_id).single();
  const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
  if (quota !== null) {
    const used = Number(ws?.storage_used_bytes ?? 0);
    if (used + a.size_bytes + a.thumbnail.size_bytes > quota) {
      return { status: 413, body: { error: "quota_exceeded", used, quota } };
    }
  }

  const upload_id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `contas/${a.conta_id}/files/${upload_id}.${extFromMime(a.mime_type)}`;
  const thumbnail_r2_key = `contas/${a.conta_id}/files/${upload_id}.thumb.webp`;
  const upload_url = await a.signPutUrl(r2_key, a.mime_type);
  const thumbnail_upload_url = await a.signPutUrl(thumbnail_r2_key, "image/webp");

  return {
    status: 200,
    body: { upload_id, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key },
  };
}

export interface FinalizeArgs {
  db: IdeiaMediaDb;
  conta_id: string;
  cliente_id?: number | null;
  ideia_id: string;
  r2_key: string;
  thumbnail_r2_key: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_bytes: number;
  name: string;
  width?: number;
  height?: number;
  blur_data_url?: string;
  sort_order?: number;
  uploaded_by?: string | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  signGetUrl: (key: string) => Promise<string>;
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("ideia_not_found")) return 404;
  if (msg.includes("image_limit")) return 409;
  if (msg.includes("quota_exceeded")) return 413;
  return 500;
}

export async function finalizeIdeiaImage(a: FinalizeArgs): Promise<IdeiaMediaResult> {
  const prefix = `contas/${a.conta_id}/files/`;
  if (!a.r2_key.startsWith(prefix) || !a.thumbnail_r2_key.startsWith(prefix)) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!IDEIA_IMAGE_MIME.includes(a.mime_type)) {
    return { status: 415, body: { error: "unsupported file type" } };
  }

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && head.contentType !== a.mime_type) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const thumbHead = await a.headObject(a.thumbnail_r2_key);
  if (!thumbHead) return { status: 400, body: { error: "thumbnail not found" } };
  if (thumbHead.contentLength !== a.thumbnail_bytes) {
    return { status: 400, body: { error: "thumbnail size mismatch" } };
  }

  const { data: inserted, error } = await a.db.rpc("ideia_file_insert_with_quota", {
    p: {
      conta_id: a.conta_id,
      cliente_id: a.cliente_id ?? "",
      ideia_id: a.ideia_id,
      r2_key: a.r2_key,
      thumbnail_r2_key: a.thumbnail_r2_key,
      name: a.name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      width: a.width ?? "",
      height: a.height ?? "",
      blur_data_url: a.blur_data_url ?? "",
      uploaded_by: a.uploaded_by ?? "",
      sort_order: a.sort_order ?? 0,
    },
  }).single();

  if (error || !inserted) {
    const msg = (error as { message?: string } | null)?.message ?? "insert failed";
    return { status: rpcErrorStatus(msg), body: { error: msg } };
  }

  const file = inserted as Record<string, unknown>;
  // Resolve the link id for this (ideia, file) pair.
  const { data: link } = await a.db.from("ideia_files")
    .select("id, sort_order").eq("ideia_id", a.ideia_id).eq("file_id", file.id).maybeSingle();

  return {
    status: 200,
    body: {
      id: (link as { id?: number } | null)?.id ?? null,
      file_id: file.id,
      url: await a.signGetUrl(a.r2_key),
      thumbnail_url: await a.signGetUrl(a.thumbnail_r2_key),
      blur_data_url: file.blur_data_url ?? null,
      width: file.width ?? null,
      height: file.height ?? null,
      sort_order: (link as { sort_order?: number } | null)?.sort_order ?? 0,
    },
  };
}
