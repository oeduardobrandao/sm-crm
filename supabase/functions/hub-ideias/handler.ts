import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { presignIdeiaImage, finalizeIdeiaImage, removeIdeiaImage } from "../_shared/ideia-media.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubIdeiasHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}

async function checkLock(db: DbClient, ideiaId: string, clienteId: number): Promise<null | boolean> {
  const { data: ideia } = await db
    .from("ideias")
    .select("status, comentario_agencia")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (!ideia) return null;
  if (ideia.status !== "nova") return true;
  if (ideia.comentario_agencia !== null) return true;

  const { count } = await db
    .from("ideia_reactions")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", ideiaId);

  return (count ?? 0) > 0;
}

export function createHubIdeiasHandler(deps: HubIdeiasHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-ideias");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];
    const ideiaId = seg[0] && seg[0].length === 36 ? seg[0] : null;
    const hasId = !!ideiaId && seg.length === 1;
    const isPresign = seg.length === 1 && seg[0] === "upload-url";
    const isFinalize = !!ideiaId && seg[1] === "files" && seg.length === 2;
    const isRemove = !!ideiaId && seg[1] === "files" && seg.length === 3;
    const removeFileId = isRemove ? Number(seg[2]) : NaN;

    const db = deps.createDb();

    const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const clienteId = hubToken.cliente_id;
    const workspaceId = hubToken.conta_id;

    // ── Image: presign ─────────────────────────────────────────────
    if (req.method === "POST" && isPresign) {
      const body = await req.json().catch(() => ({}));
      const result = await presignIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
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
      return json(result.body, result.status);
    }

    // ── Image: finalize (NOT lock-gated) ───────────────────────────
    if (req.method === "POST" && isFinalize) {
      const body = await req.json().catch(() => ({}));
      const result = await finalizeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
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
        uploaded_by: null,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(result.body, result.status);
    }

    // ── Image: remove (NOT lock-gated) ─────────────────────────────
    if (req.method === "DELETE" && isRemove) {
      if (Number.isNaN(removeFileId)) return json({ error: "invalid file id" }, 400);
      const result = await removeIdeiaImage({
        db: db as any,
        conta_id: workspaceId,
        cliente_id: clienteId,
        ideia_id: ideiaId!,
        file_id: removeFileId,
      });
      return json(result.body, result.status);
    }

    if (req.method === "GET") {
      const { data: ideias } = await db
        .from("ideias")
        .select(`
        id, titulo, descricao, links, status,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome)),
        ideia_files(id, file_id, sort_order, files(r2_key, thumbnail_r2_key, blur_data_url, width, height))
      `)
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });

      const withImages = [];
      for (const ideia of (ideias ?? []) as Array<Record<string, any>>) {
        const links = (ideia.ideia_files ?? [])
          .sort((x: any, y: any) => (x.sort_order - y.sort_order) || (x.id - y.id));
        const images = [];
        for (const row of links) {
          const f = row.files;
          if (!f) continue;
          images.push({
            id: row.id,
            file_id: row.file_id,
            url: await deps.signGetUrl(f.r2_key, 3600),
            thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
            blur_data_url: f.blur_data_url ?? null,
            width: f.width ?? null,
            height: f.height ?? null,
            sort_order: row.sort_order ?? 0,
          });
        }
        delete ideia.ideia_files;
        withImages.push({ ...ideia, images });
      }

      return json({ ideias: withImages });
    }

    if (req.method === "POST" && !hasId) {
      const body = await req.json().catch(() => ({}));
      const titulo = (body.titulo ?? "").trim();
      const descricao = (body.descricao ?? "").trim();
      const links: string[] = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (!titulo) return json({ error: "titulo obrigatório" }, 400);
      if (!descricao) return json({ error: "descricao obrigatória" }, 400);

      const { data, error } = await db
        .from("ideias")
        .insert({ workspace_id: workspaceId, cliente_id: clienteId, titulo, descricao, links, status: "nova" })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ ideia: data }, 201);
    }

    if (req.method === "PATCH" && hasId) {
      const lockResult = await checkLock(db, ideiaId!, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
      if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim();
      if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (patch.titulo === "") return json({ error: "titulo obrigatório" }, 400);
      if (patch.descricao === "") return json({ error: "descricao obrigatória" }, 400);

      const { data, error } = await db
        .from("ideias")
        .update(patch)
        .eq("id", ideiaId!)
        .eq("cliente_id", clienteId)
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ ideia: data });
    }

    if (req.method === "DELETE" && hasId) {
      const lockResult = await checkLock(db, ideiaId!, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const { error } = await db
        .from("ideias")
        .delete()
        .eq("id", ideiaId!)
        .eq("cliente_id", clienteId);

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  };
}
