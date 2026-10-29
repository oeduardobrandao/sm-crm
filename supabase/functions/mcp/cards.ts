// deno-lint-ignore-file no-explicit-any
// Card tools of the MCP Apps cards (spec 2026-10-29-mcp-apps-cards-design.md §4.3): preview_post
// and show_caption_options. Read-only: they render what the model proposes and write nothing.
import { z } from "npm:zod@3";
import { McpInputError } from "../_shared/mcp-token.ts";
import { CONTENT_FORMATS, captionMaxFor, IG_CAPTION_MAX } from "../_shared/platform-registry.ts";
import type { ContentFormat } from "../_shared/platform-registry.ts";
import { cardToolMeta } from "./apps.ts";
import type { Deps } from "./queries.ts";
import { register } from "./register.ts";
import type { ToolMeta } from "./tool-meta.ts";

export type Slide = { texto: string };

export type PreviewArgs = {
  client_id: number;
  titulo: string;
  tipo: ContentFormat;
  slides?: Slide[];
  roteiro?: string;
  ig_caption: string;
  post_id?: number;
  pilar?: string;
};

export type PreviewData = {
  card: "post_preview";
  v: 1;
  client: { id: number; nome: string };
  titulo: string;
  tipo: ContentFormat;
  pilar?: string;
  slides: Slide[];
  roteiro?: string;
  ig_caption: string;
  caption_len: number;
  caption_max: number;
  post_id?: number;
  body: string;
};

export type CaptionOptionsArgs = {
  client_id: number;
  post_id?: number;
  options: { label: string; text: string }[];
};

export type CaptionOptionsData = {
  card: "caption_options";
  v: 1;
  client: { id: number; nome: string };
  post_id?: number;
  options: { label: string; text: string; len: number }[];
  caption_max: number;
};

/** One paragraph per slide, slide 1 first: `slide_1_text` is the first line of `conteudo_plain`,
 * so no "Lâmina N" prefix (spec §4.4). */
export function slidesToBody(slides: Slide[]): string {
  return slides.map((s) => s.texto.trim()).join("\n\n");
}

/** Inverse of {@link slidesToBody}: paragraphs of a saved `conteudo_plain` back into slides. */
export function bodyToSlides(conteudoPlain: string): Slide[] {
  return conteudoPlain.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((texto) => ({ texto }));
}

async function clientOf(d: Deps, clientId: number): Promise<{ id: number; nome: string }> {
  const { data } = await d.db
    .from("clientes")
    .select("id, nome")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", clientId)
    .maybeSingle();
  if (!data) throw new McpInputError("Cliente não encontrado neste workspace.");
  return { id: (data as any).id, nome: (data as any).nome };
}

async function assertPostInWorkspace(d: Deps, postId: number): Promise<void> {
  const { data } = await d.db
    .from("workflow_posts")
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", postId)
    .maybeSingle();
  if (!data) throw new McpInputError("Post não encontrado neste workspace.");
}

export async function previewPost(d: Deps, a: PreviewArgs): Promise<PreviewData> {
  const client = await clientOf(d, a.client_id);
  if (a.post_id !== undefined) await assertPostInWorkspace(d, a.post_id);
  const slides = (a.slides ?? []).map((s) => ({ texto: s.texto }));
  return {
    card: "post_preview",
    v: 1,
    client,
    titulo: a.titulo,
    tipo: a.tipo,
    ...(a.pilar ? { pilar: a.pilar } : {}),
    slides,
    ...(a.roteiro !== undefined ? { roteiro: a.roteiro } : {}),
    ig_caption: a.ig_caption,
    caption_len: a.ig_caption.length,
    caption_max: captionMaxFor("instagram", a.tipo) ?? IG_CAPTION_MAX,
    ...(a.post_id !== undefined ? { post_id: a.post_id } : {}),
    body: a.tipo === "reels" ? (a.roteiro ?? "") : slidesToBody(slides),
  };
}

export async function captionOptions(d: Deps, a: CaptionOptionsArgs): Promise<CaptionOptionsData> {
  const client = await clientOf(d, a.client_id);
  if (a.post_id !== undefined) await assertPostInWorkspace(d, a.post_id);
  return {
    card: "caption_options",
    v: 1,
    client,
    ...(a.post_id !== undefined ? { post_id: a.post_id } : {}),
    options: a.options.map((o) => ({ label: o.label, text: o.text, len: o.text.length })),
    caption_max: IG_CAPTION_MAX,
  };
}

export function registerCardsTools(server: any, deps: Deps): void {
  register(
    server, deps, "preview_post", "posts:read",
    "Mostra ao usuário a prévia de um post antes de salvar. Use sempre que propuser um post novo ou reescrever um existente.",
    {
      client_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200),
      tipo: z.enum(CONTENT_FORMATS),
      slides: z.array(z.object({ texto: z.string().min(1).max(2000) })).max(10).optional(),
      roteiro: z.string().max(10000).optional(),
      ig_caption: z.string().max(10000),
      post_id: z.number().int().positive().optional(),
      pilar: z.string().trim().max(100).optional(),
    },
    async (a: PreviewArgs) => {
      const data = await previewPost(deps, a);
      return { summary: `Prévia de "${data.titulo}" para ${data.client.nome} mostrada ao usuário.`, data };
    },
    (a, data) => ({ client_id: a.client_id, post_id: a.post_id, tipo: a.tipo, slides: a.slides?.length ?? 0, caption_len: data.caption_len }),
    { card: true, meta: cardToolMeta() },
  );

  register(
    server, deps, "show_caption_options", "posts:read",
    "Mostra 2 ou 3 opções de legenda lado a lado para o usuário escolher.",
    {
      client_id: z.number().int().positive(),
      post_id: z.number().int().positive().optional(),
      options: z.array(z.object({
        label: z.string().trim().min(1).max(60),
        text: z.string().min(1).max(10000),
      })).min(2).max(3),
    },
    async (a: CaptionOptionsArgs) => {
      const data = await captionOptions(deps, a);
      return { summary: `Opções de legenda para ${data.client.nome} mostradas ao usuário.`, data };
    },
    (a) => ({ client_id: a.client_id, post_id: a.post_id, options: a.options.length }),
    { card: true, meta: cardToolMeta() },
  );
}

export const CARDS_TOOL_META: Record<string, ToolMeta> = {
  preview_post: { title: "Mostrar prévia do post", readOnly: true },
  show_caption_options: { title: "Mostrar opções de legenda", readOnly: true },
};
