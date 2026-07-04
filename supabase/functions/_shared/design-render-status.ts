// Shared "what did the last render actually produce" projection (docs/estudio-design.md §5.4 /
// §9's `get_design` MCP tool use the identical `render: {status, pages}` shape — this module is
// the one place that builds `pages`, so design-manage and the future MCP tool can't drift).
//
// Mirrors the media semantics in finalize_design_render (20260705000001_designs_first_class.sql):
// feed/carrossel renders create real `post_file_links` rows (`origin='design'`); reel_cover
// renders never create a link row at all — the JPEG becomes the linked video's
// `thumbnail_r2_key` instead. Zipped positionally against the CURRENT doc's pages (by
// `sort_order` / the doc's one page for reel_cover) — when the design is stale, this is a
// best-effort "last known good" preview, not a page-count-guaranteed-match.

import type { DesignDoc } from "./design-doc.ts";

export interface RenderPageInfo {
  page_id: string;
  file_id: number;
  preview_url: string;
  w: number;
  h: number;
}

export interface DesignLinkRow {
  file_id: number;
  r2_key: string;
  width: number;
  height: number;
  sort_order: number;
}

export interface VideoThumbnail {
  file_id: number;
  thumbnail_r2_key: string | null;
}

export interface RenderStatusDeps {
  fetchDesignLinks: (
    postId: number,
    contaId: string,
  ) => Promise<DesignLinkRow[]>;
  fetchVideoThumbnail: (
    postId: number,
    contaId: string,
  ) => Promise<VideoThumbnail | null>;
  signUrl: (r2Key: string) => Promise<string>;
}

export async function getRenderPages(
  deps: RenderStatusDeps,
  params: { postId: number; contaId: string; tipo: string; doc: DesignDoc },
): Promise<RenderPageInfo[]> {
  const page0 = params.doc.pages[0];

  if (params.tipo === "reels") {
    if (!page0) return [];
    const video = await deps.fetchVideoThumbnail(params.postId, params.contaId);
    if (!video?.thumbnail_r2_key) return [];
    return [{
      page_id: page0.id,
      file_id: video.file_id,
      preview_url: await deps.signUrl(video.thumbnail_r2_key),
      w: params.doc.canvas.width,
      h: params.doc.canvas.height,
    }];
  }

  const links = await deps.fetchDesignLinks(params.postId, params.contaId);
  const sorted = [...links].sort((a, b) => a.sort_order - b.sort_order);

  const out: RenderPageInfo[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const page = params.doc.pages[i];
    if (!page) break; // more rendered links than the current doc has pages — stop here.
    const link = sorted[i];
    out.push({
      page_id: page.id,
      file_id: link.file_id,
      preview_url: await deps.signUrl(link.r2_key),
      w: link.width,
      h: link.height,
    });
  }
  return out;
}
