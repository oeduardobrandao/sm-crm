import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { presignIdeiaImage, finalizeIdeiaImage, removeIdeiaImage } from "../_shared/ideia-media.ts";
import {
  buildAudioViewForIdeia,
  finalizeIdeiaAudio,
  IDEIA_AUDIO_COLUMNS,
  presignIdeiaAudio,
  removeIdeiaAudio,
  transcribeIdeiaAudio,
  type Transcriber,
} from "../_shared/ideia-audio.ts";
import { getClientIP } from "../_shared/rate-limit.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubIdeiasHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  transcribe: Transcriber | null;
  randomUUID?: () => string;
}

const HUB_IDEIA_TIPOS = ["ideia", "solicitacao"];
const AUDIO_WRITE_MAX = 20;
const AUDIO_WRITE_WINDOW = 3600;

/** Linha que o cliente pode ESCREVER: dele e criada por ele. Ideia da agência
 * compartilhada no Hub é só leitura; devolver 404 (não 403) evita sondar
 * ideias ocultas. */
async function loadOwnIdeia(db: DbClient, ideiaId: string, clienteId: number) {
  const { data } = await db
    .from("ideias")
    .select("id, status, comentario_agencia, origem")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .eq("origem", "cliente")
    .maybeSingle();
  return data as { id: string; status: string; comentario_agencia: string | null } | null;
}

async function checkLock(db: DbClient, ideiaId: string, clienteId: number): Promise<null | boolean> {
  const ideia = await loadOwnIdeia(db, ideiaId, clienteId);
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
  const signGet = (key: string) => deps.signGetUrl(key, 3600);

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
    const isAudioPresign = seg.length === 1 && seg[0] === "audio-upload-url";
    const isAudio = !!ideiaId && seg.length === 2 && seg[1] === "audio";
    const isTranscribe = !!ideiaId && seg.length === 3 && seg[1] === "audio" && seg[2] === "transcribe";

    const db = deps.createDb();

    const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const clienteId = hubToken.cliente_id;
    const workspaceId = hubToken.conta_id;

    const okRead = await deps.rateLimit(db, `hub-read:${workspaceId}:${clienteId}`, 300, 300);
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    // ── Áudio ─────────────────────────────────────────────────────
    if (isAudioPresign || isAudio || isTranscribe) {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        body = await req.json().catch(() => ({}));
      } else if (req.method !== "DELETE" || !isAudio) {
        return json({ error: "Method not allowed" }, 405);
      }
      const scope = { db: db as any, workspace_id: workspaceId, origem: "cliente" as const, cliente_id: clienteId };

      // Só a ESCRITA de áudio é paga; DELETE fica fora para o cliente poder
      // remover o que gravou depois de um downgrade.
      if (req.method === "POST") {
        const audioOn = await effectivePlanFeature(db as never, workspaceId, "feature_briefing_audio");
        if (!audioOn) return json({ error: "Recurso indisponível no plano atual." }, 403);
        const okWrite = await deps.rateLimit(
          db, `hub-write:hub-ideias-audio:${workspaceId}:${clienteId}`, AUDIO_WRITE_MAX, AUDIO_WRITE_WINDOW,
        );
        if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      }

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

    // ── Image: presign ─────────────────────────────────────────────
    if (req.method === "POST" && isPresign) {
      const body = await req.json().catch(() => ({}));
      const own = await loadOwnIdeia(db, String(body.ideia_id ?? ""), clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
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

    // ── Image: finalize (NOT lock-gated, origin-gated) ─────────────
    if (req.method === "POST" && isFinalize) {
      const own = await loadOwnIdeia(db, ideiaId!, clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
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

    // ── Image: remove (NOT lock-gated, origin-gated) ───────────────
    if (req.method === "DELETE" && isRemove) {
      if (Number.isNaN(removeFileId)) return json({ error: "invalid file id" }, 400);
      const own = await loadOwnIdeia(db, ideiaId!, clienteId);
      if (!own) return json({ error: "Ideia não encontrada." }, 404);
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
        id, titulo, descricao, links, status, tipo, tarefa_id, origem,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        audio_transcript, ${IDEIA_AUDIO_COLUMNS},
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome)),
        ideia_files(id, file_id, sort_order, files(r2_key, thumbnail_r2_key, blur_data_url, width, height))
      `)
        .eq("cliente_id", clienteId)
        .eq("workspace_id", workspaceId)
        .eq("visivel_no_hub", true)
        .order("created_at", { ascending: false });

      const out = [];
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
        // Assinar o áudio é I/O externo: falha em uma ideia custa só o player dela.
        let audio = null;
        try {
          audio = await buildAudioViewForIdeia(ideia as any, signGet);
        } catch (e) {
          console.error("hub-ideias:sign-audio", ideia.id, (e as Error).message ?? e);
        }
        const {
          ideia_files: _f, audio_transcript: _t, audio_r2_key: _k, audio_mime: _m, audio_size_bytes: _s,
          audio_duration_seconds: _d, audio_transcription_status: _st, audio_recorded_at: _r, ...rest
        } = ideia;
        out.push({ ...rest, images, audio });
      }

      return json({ ideias: out });
    }

    if (req.method === "POST" && !hasId) {
      const okWrite = await deps.rateLimit(
        db, `hub-write:hub-ideias:${workspaceId}:${clienteId}`, 30, 3600,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

      const body = await req.json().catch(() => ({}));
      const titulo = (body.titulo ?? "").trim();
      // Optional: an ideia can be conveyed entirely through its audio recording
      // instead, uploaded in a separate call right after this one returns the id --
      // there's no way to know at this point whether that call is coming, so this
      // route can't enforce "at least one of descricao/audio" itself. The client UI
      // does (NovaIdeiaDialog / IdeiaModal), same as the agency-side CRM flow.
      const descricao = (body.descricao ?? "").trim() || null;
      const links: string[] = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (!titulo) return json({ error: "titulo obrigatório" }, 400);

      const tipo = body.tipo === undefined ? "ideia" : String(body.tipo);
      if (!HUB_IDEIA_TIPOS.includes(tipo)) return json({ error: "tipo inválido" }, 400);

      // origem/visivel_no_hub/audio_* nunca vêm do cliente: defaults do banco.
      const { data, error } = await db
        .from("ideias")
        .insert({ workspace_id: workspaceId, cliente_id: clienteId, titulo, descricao, links, tipo, status: "nova" })
        .select()
        .single();

      if (error) return internalServerError(json, "hub-ideias:create", error);
      return json({ ideia: data }, 201);
    }

    if (req.method === "PATCH" && hasId) {
      const lockResult = await checkLock(db, ideiaId!, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
      // Optional, same as create -- an existing ideia may already carry its content
      // as audio_transcript, so clearing the text here isn't necessarily invalid.
      if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim() || null;
      if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];
      if (body.tipo !== undefined) {
        if (!HUB_IDEIA_TIPOS.includes(String(body.tipo))) return json({ error: "tipo inválido" }, 400);
        patch.tipo = String(body.tipo);
      }

      if (patch.titulo === "") return json({ error: "titulo obrigatório" }, 400);

      const { data, error } = await db
        .from("ideias")
        .update(patch)
        .eq("id", ideiaId!)
        .eq("cliente_id", clienteId)
        .eq("origem", "cliente")
        .select()
        .single();

      if (error) return internalServerError(json, "hub-ideias:update", error);
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
        .eq("cliente_id", clienteId)
        .eq("origem", "cliente");

      if (error) return internalServerError(json, "hub-ideias:delete", error);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  };
}
