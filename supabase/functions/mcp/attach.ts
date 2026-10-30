// deno-lint-ignore-file no-explicit-any
// Cards (MCP Apps): anexar imagens do chat a um post. `show_attach_image` mostra o card com os
// slides do post e as imagens (uma ou várias); `attach_image_to_post` (só o widget chama, só OAuth,
// uma imagem por chamada) baixa a imagem com o fetch endurecido, sobe para o R2 e liga ao post pela RPC
// `mcp_attach_post_file_v2` (confere o estado que o card esperava e, com `trim_after`, tira os slides
// depois dela na mesma transação). Sem expectativa (card antigo em cache) usa `mcp_attach_post_file`.
// Specs: docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §4.6 e
// docs/superpowers/specs/2026-10-29-mcp-attach-multi-images-design.md.
import { z } from "npm:zod@3";
import { signGetUrl } from "../_shared/r2.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { fetchImageSafely } from "../_shared/safe-image-fetch.ts";
import { imageDimensions } from "../_shared/image-dimensions.ts";
import { cardToolMeta, appOnlyToolMeta, widgetOnly } from "./apps.ts";
import { createMediaUpload } from "./media.ts";
import { EDITABLE_STATUSES, type Deps } from "./queries.ts";
import { type CardRun, register } from "./register.ts";
import type { ToolMeta } from "./tool-meta.ts";

export const ATTACH_TOOL_META: Record<string, ToolMeta> = {
  show_attach_image: { title: "Mostrar onde anexar a imagem", readOnly: true },
  attach_image_to_post: { title: "Anexar imagem ao post", readOnly: false },
};

const MAX_MEDIA = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const PUT_TIMEOUT_MS = 30_000;
const IMAGE_TIPOS = ["feed", "carrossel"];
const CLIENT_STATUSES = ["enviado_cliente", "aprovado_cliente"];
const TIKTOK_LOCKED = ["initiated", "processing", "published"];

const MSG = {
  download: "Não foi possível baixar esta imagem. Envie de novo pelo chat.",
  format: "Formato não aceito. Use JPG ou PNG.",
  size: "A imagem passa de 8 MB. Gere uma versão menor.",
  mediaFull: "Este post já tem 10 mídias. Substitua um slide.",
  withClient: "Este post está com o cliente. Volte para rascunho no Mesaas para mudar as imagens.",
  notEditable: "Este post não está em edição. Volte para rascunho no Mesaas para mudar as imagens.",
  published: "Este post já foi publicado. As imagens não podem mais ser trocadas por aqui.",
  tipoOther: "Este tipo de post não recebe imagens.",
  staleSlide: "O slide escolhido não existe mais neste post. Abra o card de novo para ver os slides atuais.",
  quota: "Cota de armazenamento excedida. Libere espaço em Arquivos.",
  notFound: "Post não encontrado neste workspace.",
  workspace: "Você não tem mais acesso a este workspace no Mesaas.",
  saveFailed: "Não foi possível salvar a imagem no post. Tente de novo.",
  imagesArg: "Envie as imagens em `images` (uma lista, na ordem do chat).",
  stalePost: "O post mudou no Mesaas depois que o card abriu. Peça para abrir o card de novo.",
};

const tipoMessage = (tipo: string) =>
  tipo === "reels" || tipo === "stories" ? `Posts do tipo ${tipo} não recebem imagens.` : MSG.tipoOther;
const statusMessage = (status: string) => (CLIENT_STATUSES.includes(status) ? MSG.withClient : MSG.notEditable);
const slideRangeMessage = (max: number) =>
  max === 0
    ? "Este post ainda não tem slides. Adicione a imagem como novo slide."
    : `Este slide não existe neste post. Escolha um slide de 1 a ${max}.`;

/** `MCP_IMAGE_HOSTS`: exact hostnames (comma-separated, trimmed, any case). Empty refuses every
 * image. A refusal logs only the hostname, so the pilot can read ChatGPT's file host from the log. */
export function allowedImageHost(url: string, list: string | undefined): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hosts = (list ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hosts.includes(hostname)) return true;
  console.warn(`[mcp] image host refused: ${hostname}`);
  return false;
}

const POST_ELIGIBILITY_COLS =
  "id, titulo, tipo, status, cliente_id, published_at, instagram_media_id, instagram_container_id, " +
  "publish_processing_at, tiktok_publish_processing_at, tiktok_publish_status";

async function loadPost(d: Deps, postId: number): Promise<any | null> {
  const { data } = await d.db
    .from("workflow_posts")
    .select(POST_ELIGIBILITY_COLS)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", postId)
    .maybeSingle();
  return data ?? null;
}

async function loadMedia(d: Deps, postId: number): Promise<Array<{ id: number; r2_key: string }>> {
  const { data } = await d.db
    .from("post_file_links")
    .select("id, sort_order, files!inner(r2_key)")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", postId)
    .order("sort_order")
    .order("id"); // same (sort_order, id) order the RPC normalizes by
  return ((data ?? []) as any[]).map((l) => ({ id: l.id, r2_key: l.files.r2_key }));
}

/** Cheap mirror of the RPC's gate (publish state, status, tipo); the RPC re-checks under the row
 * lock. Null = eligible. */
function ineligibleReason(p: any): string | null {
  const publishing = p.published_at || p.instagram_media_id || p.instagram_container_id ||
    p.publish_processing_at || p.tiktok_publish_processing_at || TIKTOK_LOCKED.includes(p.tiktok_publish_status);
  if (publishing) return MSG.published;
  if (!EDITABLE_STATUSES.includes(p.status)) return statusMessage(p.status);
  if (!IMAGE_TIPOS.includes(p.tipo)) return tipoMessage(p.tipo);
  return null;
}

const RPC_RAISES = [
  "media_full", "post_not_found", "post_published", "invalid_position", "invalid_file", "quota_exceeded",
  "workspace_unavailable", "stale_post",
];

/** True only for the RPC's own raises, which roll the transaction back. A transport failure or a
 * gateway 5xx also comes back as `{error}` and may follow a commit, so its key is never queued. */
function isRpcRaise(message: string): boolean {
  return RPC_RAISES.includes(message) || message.startsWith("post_not_editable:") ||
    message.startsWith("tipo_not_image:");
}

function mapAttachError(message: string): string {
  if (message === "media_full") return MSG.mediaFull;
  if (message === "post_not_found") return MSG.notFound;
  if (message === "post_published") return MSG.published;
  // The detail may be a status or a publish-state reason: pick the copy, never echo it.
  if (message.startsWith("post_not_editable:")) return statusMessage(message.slice("post_not_editable:".length));
  if (message.startsWith("tipo_not_image:")) return tipoMessage(message.slice("tipo_not_image:".length));
  if (message === "invalid_position") return MSG.staleSlide;
  if (message === "stale_post") return MSG.stalePost;
  if (message === "quota_exceeded") return MSG.quota;
  if (message === "workspace_unavailable") return MSG.workspace;
  // invalid_file (key outside the workspace or a mime we never send) is our bug, not the user's.
  return MSG.saveFailed;
}

/** Display name from the chat's file name: basename, trimmed, capped; default by extension. */
function fileName(raw: string | undefined, ext: string): string {
  const base = (raw ?? "").split(/[\\/]/).pop()!.trim().slice(0, 120);
  return base || `imagem-do-chat.${ext}`;
}

/** The card's copy of a chat file: only the fields the widget needs, never extra keys. */
function imagePayload(i: { download_url: string; file_id: string; mime_type?: string; file_name?: string }) {
  return {
    download_url: i.download_url,
    file_id: i.file_id,
    ...(i.mime_type ? { mime_type: i.mime_type } : {}),
    ...(i.file_name ? { file_name: i.file_name } : {}),
  };
}

const imageShape = {
  download_url: z.string().url().max(4096),
  file_id: z.string().min(1).max(256),
  mime_type: z.string().max(100).optional(),
  file_name: z.string().max(255).optional(),
};

export function registerAttachTools(server: any, deps: Deps): void {
  const signUrl = deps.signUrl ?? ((key: string) => signGetUrl(key, 3600));

  register(
    server,
    deps,
    "show_attach_image",
    "posts:read",
    "Mostra um card com os slides do post e onde as imagens do chat entrariam. A pessoa ajusta e " +
      "confirma no próprio card; este tool não anexa nada. Use quando a pessoa pedir para colocar imagens " +
      "geradas ou enviadas no chat em um post do Mesaas. Passe TODAS as imagens do pedido em `images`, na " +
      "ordem em que a pessoa enviou, numa chamada só: nunca abra um card por imagem. Mais de 10: mande as " +
      "10 primeiras e diga à pessoa que as outras precisam de outro post. `position` (1 a 10) sugere o " +
      "slide e só vale com uma imagem.",
    {
      post_id: z.number().int().positive(),
      images: z.array(z.object(imageShape)).min(1).max(MAX_MEDIA).optional(),
      image: z.object(imageShape).optional(),
      position: z.number().int().min(1).max(MAX_MEDIA).optional(),
    },
    async (args): Promise<CardRun> => {
      // `image` is the old single-file field (hosts holding the earlier tool listing). A model that fills
      // both gets them merged, `image` first, each file once.
      const all = [...(args.image ? [args.image] : []), ...(args.images ?? [])];
      const images = all.filter((i, n) => all.findIndex((j) => j.file_id === i.file_id) === n)
        .slice(0, MAX_MEDIA).map(imagePayload);
      if (images.length === 0) throw new McpInputError(MSG.imagesArg);
      const post = await loadPost(deps, args.post_id);
      if (!post) throw new McpInputError(MSG.notFound);
      const [links, client] = await Promise.all([
        loadMedia(deps, post.id),
        post.cliente_id
          ? deps.db.from("clientes").select("id, nome").eq("conta_id", deps.ctx.conta_id).eq("id", post.cliente_id)
            .maybeSingle().then((r: any) => r.data ?? null)
          : Promise.resolve(null),
      ]);
      const media = await Promise.all(
        links.map(async (l, i) => ({ position: i + 1, url: await signUrl(l.r2_key), link_id: l.id })),
      );
      const reason = ineligibleReason(post);
      const titulo = post.titulo ?? "sem título";
      const what = images.length === 1 ? "a imagem" : `as ${images.length} imagens`;
      const summary = reason
        ? `O post "${titulo}" não pode receber ${what} agora: ${reason}`
        : `Card aberto com as ${media.length} mídias do post "${titulo}" e ${what} do chat ` +
          `(máximo ${MAX_MEDIA} slides). A pessoa confirma no card; nada foi anexado ainda.` +
          (images.length > 1
            ? " Se o card mostrar só uma imagem, o app está numa versão antiga: peça para atualizar o conector."
            : "");
      return {
        summary,
        data: {
          card: "attach_image",
          v: 1,
          post: { id: post.id, titulo: post.titulo, tipo: post.tipo, status: post.status },
          client: client ? { id: client.id, nome: client.nome } : null,
          media,
          max: MAX_MEDIA,
          eligible: reason === null,
          ...(reason ? { reason } : {}),
          images,
          // The card cached by hosts before multi-image support reads only `image`.
          image: images[0],
          ...(args.position !== undefined && images.length === 1 ? { position: args.position } : {}),
        },
      };
    },
    (a) => ({ post_id: a.post_id, position: a.position, images: (a.images ?? (a.image ? [a.image] : [])).length }),
    { card: true, meta: { ...cardToolMeta(), "openai/fileParams": ["images", "image"] } },
  );

  if (!widgetOnly(deps)) return;

  register(
    server,
    deps,
    "attach_image_to_post",
    "posts:write",
    "Anexa a imagem do chat ao post no slide escolhido no card. Só o card chama. `expected_link_id` " +
      "(substituir) ou `expected_count` (anexar) é o que o card viu; se o post mudou, recusa. `trim_after` " +
      "tira do post os slides depois deste (última imagem de \"Substituir os slides atuais\").",
    {
      post_id: z.number().int().positive(),
      image: z.object(imageShape),
      position: z.number().int().min(1).max(MAX_MEDIA),
      replace: z.boolean(),
      expected_count: z.number().int().min(0).max(MAX_MEDIA).optional(),
      expected_link_id: z.number().int().positive().optional(),
      trim_after: z.boolean().optional(),
    },
    async (args) => {
      // 1. Host allowlist, then a cheap eligibility check: most refusals before any download.
      if (!allowedImageHost(args.image.download_url, Deno.env.get("MCP_IMAGE_HOSTS"))) {
        throw new McpInputError(MSG.download);
      }
      const post = await loadPost(deps, args.post_id);
      if (!post) throw new McpInputError(MSG.notFound);
      const reason = ineligibleReason(post);
      if (reason) throw new McpInputError(reason);
      const current = await loadMedia(deps, post.id);
      const count = current.length;
      // The card's expectation (cards from before the multi-image card send none): checked again by
      // the v2 RPC under the row lock; here it only saves a download when the post already moved.
      const expects = args.expected_count !== undefined || args.expected_link_id !== undefined;
      if (expects) {
        const stale = args.replace
          ? current[args.position - 1]?.id !== args.expected_link_id
          : count !== args.expected_count;
        if (stale) throw new McpInputError(MSG.stalePost);
      }
      if (args.replace) {
        if (args.position > count) throw new McpInputError(slideRangeMessage(count));
      } else {
        if (count >= MAX_MEDIA) throw new McpInputError(MSG.mediaFull);
        if (args.position > count + 1) throw new McpInputError(slideRangeMessage(count + 1));
      }

      // 2. Hardened fetch (https, public IPs only, no redirects, 8 MB cap) and sniff.
      if (!deps.resolveDns || !deps.fetchUrl) throw new Error("attach_image_to_post: fetch deps missing");
      const fetched = await fetchImageSafely(
        { resolveDns: deps.resolveDns, fetchUrl: deps.fetchUrl },
        args.image.download_url,
        { maxBytes: MAX_IMAGE_BYTES, timeoutMs: FETCH_TIMEOUT_MS },
      );
      if (!fetched.ok) {
        console.warn(`[mcp] attach image fetch refused: ${fetched.reason}`);
        if (fetched.reason === "too_large") throw new McpInputError(MSG.size);
        if (fetched.reason === "not_an_image") throw new McpInputError(MSG.format);
        throw new McpInputError(MSG.download);
      }
      if (fetched.mime !== "image/png" && fetched.mime !== "image/jpeg") throw new McpInputError(MSG.format);
      const mime = fetched.mime as "image/png" | "image/jpeg";
      const bytes = fetched.bytes;
      const dims = imageDimensions(bytes, mime);

      // 3. Quota precheck + presigned PUT (create_media_upload's path), then the upload itself.
      let upload: { r2_key: string; upload_url: string };
      try {
        [upload] = (await createMediaUpload(deps, {
          files: [{ filename: "imagem", mime_type: mime, size_bytes: bytes.byteLength }],
        })).uploads;
      } catch (e) {
        if (e instanceof McpInputError) throw new McpInputError(MSG.quota);
        throw e;
      }
      let put: Response;
      try {
        put = await deps.fetchUrl(upload.upload_url, {
          method: "PUT",
          body: new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength),
          headers: { "Content-Type": mime },
          signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        });
        await put.body?.cancel().catch(() => undefined);
      } catch (e) {
        // Never log `e` itself: fetch errors embed the presigned URL (a live write credential).
        console.error(`[mcp] attach image upload failed: ${e instanceof Error ? e.name : "unknown"}`);
        throw new McpInputError(MSG.saveFailed);
      }
      if (!put.ok) {
        // Nothing stored; a partial object is unreferenced and the orphan scan reaps it.
        console.error(`[mcp] attach image upload failed: HTTP ${put.status}`);
        throw new McpInputError(MSG.saveFailed);
      }

      // 4. One RPC: membership, row lock, the card's expectation, eligibility, quota, the link and
      // the trim, in one transaction.
      const rpcName = expects ? "mcp_attach_post_file_v2" : "mcp_attach_post_file";
      const { data, error } = await deps.db.rpc(rpcName, {
        p_conta_id: deps.ctx.conta_id,
        p_post_id: args.post_id,
        p_actor: deps.ctx.created_by,
        p_file: {
          r2_key: upload.r2_key,
          name: fileName(args.image.file_name, mime === "image/png" ? "png" : "jpg"),
          mime_type: mime,
          size_bytes: bytes.byteLength,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        },
        p_position: args.position,
        p_replace: args.replace,
        ...(expects
          ? {
            p_expected_count: args.expected_count ?? null,
            p_expected_link_id: args.expected_link_id ?? null,
            p_trim_after: args.trim_after === true,
          }
          : {}),
      });
      if (error) {
        const raw = (error as { message?: string }).message ?? "";
        console.error(`[mcp] ${rpcName} failed:`, raw);
        if (!isRpcRaise(raw)) {
          // Outcome unknown: the link may have committed. Leave the object; the orphan scan reaps it
          // only when no `files` row references it.
          throw new McpInputError(MSG.saveFailed);
        }
        const { error: queueError } = await deps.db.from("file_deletions").insert({ r2_key: upload.r2_key });
        if (queueError) console.error("[mcp] file_deletions enqueue failed:", queueError);
        throw new McpInputError(mapAttachError(raw));
      }
      const r = (data ?? {}) as {
        link_id?: number;
        file_id?: number;
        is_cover?: boolean;
        tipo?: string;
        trimmed?: number;
      };

      return {
        post_id: args.post_id,
        position: args.position,
        replace: args.replace,
        link_id: r.link_id,
        file_id: r.file_id,
        is_cover: r.is_cover,
        tipo: r.tipo,
        url: await signUrl(upload.r2_key),
        ...(r.trimmed !== undefined ? { trimmed: r.trimmed } : {}),
      };
    },
    (a) => ({ post_id: a.post_id, position: a.position, replace: a.replace, trim_after: a.trim_after === true }),
    { meta: appOnlyToolMeta() },
  );
}
