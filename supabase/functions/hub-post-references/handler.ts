// Referências do cliente no post, lado Hub (token). Spec:
// docs/superpowers/specs/2026-10-08-client-post-references-design.md
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { computeEmProducaoByPost, isHubVisiblePost, type StatusEventRow } from "../hub-posts/em-producao.ts";
import { loadOpenRequestsForClient, type MaterialRequestDTO } from "../_shared/material-requests.ts";

/** Quem abriu o pedido (uuid de membro da equipe) nunca vai para o Hub. */
export type HubMaterialRequestDTO = Omit<MaterialRequestDTO, "opened_by">;
function toHubRequest(r: MaterialRequestDTO): HubMaterialRequestDTO {
  const { opened_by: _openedBy, opened_by_name: _openedByName, ...rest } = r as MaterialRequestDTO & {
    opened_by_name?: unknown;
  };
  return rest;
}

/**
 * Janela depois do concluido/auto em que o RPC ainda aceita arquivo de item (o resto da mesma
 * seleção múltipla). Espelha post_reference_file_insert/link_insert (20261121000001).
 */
const AUTO_CLOSE_GRACE_MS = 10 * 60 * 1000;
import {
  finalizeReferenceFile,
  type HeadObject,
  insertReferenceLink,
  listPostReferences,
  MAX_REFERENCES_PER_POST,
  normalizeReferenceNote,
  parsePositiveId,
  presignReferenceUpload,
  referenceError,
  type ReferenceItem,
  type ReferenceResult,
  type ReferencesDb,
  type SignGetUrl,
  type SignPutUrl,
} from "../_shared/post-references.ts";

type DbClient = ReferencesDb;

export interface HubPostReferencesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signPutUrl: SignPutUrl;
  signGetUrl: SignGetUrl;
  headObject: HeadObject;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  randomUUID?: () => string;
}

// Escritas debitam SÓ este pool, nunca o hub-read compartilhado (mesmo racional de
// hub-edit-suggestion/handler.ts:77-85). Um arquivo custa 2 (presign + finalize) e
// "Salvar nota" é botão explícito (1), então 10 arquivos com nota num post gastam 30.
const WRITE_MAX = 120;
const WRITE_WINDOW = 3600;
const READ_MAX = 300;
const READ_WINDOW = 300;

type Route = "list" | "presign" | "files" | "links" | "update" | "delete" | "requests" | "close";

function resolveRoute(method: string, seg: string[]): { route: Route; refId: number | null } | null {
  if (seg.length === 1 && seg[0] === "requests" && method === "GET") return { route: "requests", refId: null };
  if (seg.length === 3 && seg[0] === "requests" && seg[2] === "close" && method === "POST") {
    const postId = parsePositiveId(seg[1]);
    return postId === null ? null : { route: "close", refId: postId };
  }
  if (seg.length === 0 && method === "GET") return { route: "list", refId: null };
  if (seg.length === 1 && method === "POST") {
    if (seg[0] === "upload-url") return { route: "presign", refId: null };
    if (seg[0] === "files") return { route: "files", refId: null };
    if (seg[0] === "links") return { route: "links", refId: null };
    return null;
  }
  if (seg.length === 1 && (method === "PATCH" || method === "DELETE")) {
    const refId = parsePositiveId(seg[0]);
    if (refId === null) return null;
    return { route: method === "PATCH" ? "update" : "delete", refId };
  }
  return null;
}

/** Resultado dos RPCs de cliente ('ok' | 'not_found' | 'locked'); null = ok. */
function clientMutationOutcome(data: unknown, error: unknown, scope: string): ReferenceResult | null {
  if (error) {
    console.error(`[hub-post-references:${scope}] rpc failed:`, error);
    return referenceError("internal");
  }
  if (data === "ok") return null;
  if (data === "not_found") return referenceError("not_found");
  if (data === "locked") return referenceError("locked");
  console.error(`[hub-post-references:${scope}] unexpected rpc result:`, data);
  return referenceError("internal");
}

export function createHubPostReferencesHandler(deps: HubPostReferencesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const send = (r: ReferenceResult) => json(r.body, r.status);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hub-post-references");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const resolved = resolveRoute(req.method, seg);
    if (!resolved) return send(referenceError("not_found"));
    const { route, refId } = resolved;

    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PATCH") {
      const parsed = await req.json().catch(() => null);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    }

    const token = url.searchParams.get("token") ?? (typeof body.token === "string" ? body.token : null);
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();
    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return send(referenceError("rate_limited"));
      return json({ error: "Link inválido." }, 404);
    }
    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    const allowed = route === "list" || route === "requests"
      ? await deps.rateLimit(db, `hub-read:${contaId}:${clienteId}`, READ_MAX, READ_WINDOW)
      : await deps.rateLimit(db, `hub-write:hub-post-references:${contaId}:${clienteId}`, WRITE_MAX, WRITE_WINDOW);
    if (!allowed) return send(referenceError("rate_limited"));

    // ── GET /requests: pedidos abertos do cliente. Select de posts com colunas fixas
    // (nunca legenda, conteúdo nem mídia: rascunho não vaza).
    if (route === "requests") {
      let open: Map<number, MaterialRequestDTO>;
      try {
        open = await loadOpenRequestsForClient(db, contaId, clienteId);
      } catch (e) {
        console.error("[hub-post-references:requests] load failed:", e);
        return send(referenceError("internal"));
      }
      if (open.size === 0) return json({ requests: [] });
      const ids = [...open.keys()];
      const { data: postRows, error: postsErr } = await db.from("workflow_posts")
        .select("id, titulo, tipo, scheduled_at, platform, status")
        .in("id", ids)
        .eq("cliente_id", clienteId)
        .eq("conta_id", contaId);
      if (postsErr) {
        console.error("[hub-post-references:requests] posts lookup failed:", postsErr);
        return send(referenceError("internal"));
      }
      type PostRow = {
        id: number; titulo: string | null; tipo: string | null; scheduled_at: string | null;
        platform: string | null; status: string;
      };
      const posts = (Array.isArray(postRows) ? postRows : []) as PostRow[];
      const { data: eventRows, error: eventsErr } = await db.from("post_status_events")
        .select("id, post_id, from_status, to_status, created_at")
        .eq("conta_id", contaId)
        .in("post_id", posts.map((p) => p.id))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (eventsErr) {
        console.error("[hub-post-references:requests] status events lookup failed:", eventsErr);
        return send(referenceError("internal"));
      }
      const emProducao = computeEmProducaoByPost((Array.isArray(eventRows) ? eventRows : []) as StatusEventRow[]);
      const requests = [];
      for (const p of posts) {
        const request = open.get(Number(p.id));
        if (!request) continue;
        const listed = await listPostReferences({
          db, post_id: p.id, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: false,
        });
        if (!listed.ok) return send(listed.result);
        const filesByItem: Record<number, ReferenceItem[]> = {};
        for (const it of listed.items) {
          if (it.material_item_id === null) continue;
          (filesByItem[it.material_item_id] ??= []).push(it);
        }
        requests.push({
          post_id: p.id,
          titulo: p.titulo,
          tipo: p.tipo,
          scheduled_at: p.scheduled_at,
          platform: p.platform,
          client_visible: isHubVisiblePost({ id: p.id, status: p.status }, emProducao),
          request: toHubRequest(request),
          files_by_item: filesByItem,
        });
      }
      requests.sort((a, b) => {
        if (a.scheduled_at !== b.scheduled_at) {
          if (a.scheduled_at === null) return 1;
          if (b.scheduled_at === null) return -1;
          return a.scheduled_at.localeCompare(b.scheduled_at);
        }
        return a.request.opened_at.localeCompare(b.request.opened_at);
      });
      return json({ requests });
    }

    // ── POST /requests/:postId/close: o RPC confere cliente/conta sob o lock.
    if (route === "close") {
      const { data, error } = await db.rpc("post_material_client_close", {
        p_conta: contaId, p_cliente: clienteId, p_post: refId,
      });
      if (error) {
        console.error("[hub-post-references:close] rpc failed:", error);
        return send(referenceError("internal"));
      }
      if (data === "ok") return json({ ok: true });
      if (data === "not_found") return send(referenceError("not_found"));
      if (data === "request_closed") return send(referenceError("request_closed"));
      if (data === "nothing_sent") return send(referenceError("nothing_sent"));
      console.error("[hub-post-references:close] unexpected rpc result:", data);
      return send(referenceError("internal"));
    }

    // ── PATCH /:id e DELETE /:id: o RPC confere cliente/conta e can_remove sob o
    // lock do post, então não há leitura prévia aqui (seria só uma corrida a mais).
    if (route === "update") {
      const note = normalizeReferenceNote(body.note);
      if (!note.ok) return send(referenceError("invalid_note"));
      const { data, error } = await db.rpc("post_reference_client_update", {
        p_id: refId, p_conta: contaId, p_cliente: clienteId, p_note: note.value,
      });
      const outcome = clientMutationOutcome(data, error, "update");
      if (outcome) return send(outcome);
      const { data: ref, error: refErr } = await db.from("post_references")
        .select("post_id").eq("id", refId).eq("conta_id", contaId).maybeSingle();
      if (refErr) {
        // A nota já foi salva: um erro transitório aqui não pode virar 404.
        console.error("[hub-post-references:update] post lookup failed:", refErr);
        return send(referenceError("internal"));
      }
      const postId = parsePositiveId((ref as { post_id?: unknown } | null)?.post_id);
      if (postId === null) return send(referenceError("not_found"));
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: false,
      });
      if (!listed.ok) return send(listed.result);
      const item = listed.items.find((i) => i.id === refId);
      return item ? json({ item }) : send(referenceError("not_found"));
    }

    if (route === "delete") {
      const { data, error } = await db.rpc("post_reference_client_delete", {
        p_id: refId, p_conta: contaId, p_cliente: clienteId,
      });
      const outcome = clientMutationOutcome(data, error, "delete");
      if (outcome) return send(outcome);
      return json({ ok: true });
    }

    // ── Rotas por post: posse pelo cliente_id/conta_id do PRÓPRIO post (vale para
    // post avulso, como hub-approve). 404, não 403: não confirma que o id existe.
    const postId = parsePositiveId(route === "list" ? url.searchParams.get("post_id") : body.post_id);
    if (postId === null) return send(referenceError("not_found"));
    const { data: post, error: postErr } = await db.from("workflow_posts")
      .select("id, status, cliente_id, conta_id")
      .eq("id", postId)
      .maybeSingle();
    if (postErr) {
      console.error("[hub-post-references] post lookup failed:", postErr);
      return send(referenceError("internal"));
    }
    const owned = post as { status: string; cliente_id: number; conta_id: string } | null;
    if (!owned || owned.cliente_id !== clienteId || owned.conta_id !== contaId) {
      return send(referenceError("not_found"));
    }

    if (route === "list") {
      // Só posse, sem gate de status (como hub-post-history): um post pode seguir
      // visível "em produção" num status interno depois de um envio.
      const listed = await listPostReferences({
        db, post_id: postId, conta_id: contaId, signGetUrl: deps.signGetUrl, includeDownload: false,
      });
      if (!listed.ok) return send(listed.result);
      let request: MaterialRequestDTO | null;
      try {
        request = (await loadOpenRequestsForClient(db, contaId, clienteId)).get(postId) ?? null;
      } catch (e) {
        console.error("[hub-post-references:list] request load failed:", e);
        return send(referenceError("internal"));
      }
      return json({
        can_add: owned.status === "enviado_cliente" && listed.items.length < MAX_REFERENCES_PER_POST,
        items: listed.items,
        request: request ? toHubRequest(request) : null,
      });
    }

    // Gate de escrita (decisão 1). Best-effort: os RPCs rechecam sob FOR UPDATE.
    // Pedido de material aberto também libera (rascunho com pedido). Só consulta o
    // pedido quando o status sozinho não libera.
    if (owned.status !== "enviado_cliente") {
      let open: Map<number, MaterialRequestDTO>;
      try {
        open = await loadOpenRequestsForClient(db, contaId, clienteId);
      } catch (e) {
        console.error("[hub-post-references:gate] request load failed:", e);
        return send(referenceError("internal"));
      }
      if (open.get(postId)?.status !== "aberto") {
        // Recém-concluído pelo próprio upload (concluido/auto há menos de 10 min): os arquivos
        // seguintes da mesma seleção ainda passam; o RPC confere a mesma regra sob o lock.
        const { data: q, error: qErr } = await db.from("post_material_requests")
          .select("status, closed_by, closed_at")
          .eq("conta_id", contaId).eq("post_id", postId).maybeSingle();
        if (qErr) {
          console.error("[hub-post-references:gate] request lookup failed:", qErr);
          return send(referenceError("internal"));
        }
        const r = q as { status?: string; closed_by?: string | null; closed_at?: string | null } | null;
        const closedAt = r?.closed_at ? Date.parse(r.closed_at) : NaN;
        const recentAuto = r?.status === "concluido" && r.closed_by === "auto" &&
          Number.isFinite(closedAt) && Date.parse(deps.now()) - closedAt < AUTO_CLOSE_GRACE_MS;
        if (!recentAuto) return send(referenceError("post_not_pending"));
      }
    }

    if (route === "presign") {
      return send(await presignReferenceUpload({
        db,
        conta_id: contaId,
        post_id: postId,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes,
        thumbnail: body.thumbnail,
        signPutUrl: deps.signPutUrl,
        randomUUID: deps.randomUUID,
      }));
    }

    const result = route === "files"
      ? await finalizeReferenceFile({
        db, conta_id: contaId, cliente_id: clienteId, post_id: postId, input: body,
        headObject: deps.headObject, signGetUrl: deps.signGetUrl,
      })
      : await insertReferenceLink({
        db, conta_id: contaId, cliente_id: clienteId, post_id: postId, input: body,
        signGetUrl: deps.signGetUrl,
      });

    if (result.status < 300) {
      // Não fatal: a referência já existe; o RPC agrupa avisos em 15 min por post.
      try {
        const { error: notifErr } = await db.rpc("create_post_reference_notification", { p_post_id: postId });
        if (notifErr) console.error("[hub-post-references] notification failed:", notifErr);
      } catch (e) {
        console.error("[hub-post-references] notification threw:", e);
      }
    }
    return send(result);
  };
}
