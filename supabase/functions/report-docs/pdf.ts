// POST /:id/pdf (spec §5/§9). Cache: serve o PDF existente só se
// pdf_generated_at >= updated_at E pdf_renderer_version bate -- updated_at NÃO
// bumpa em escrita de pdf_* (trigger condicional da migration 20260821000010).
// pdf_generated_at grava o horário de INÍCIO da conversão (nowMs, capturado
// antes do await de convert), não o de término. Uma edição DURANTE a
// conversão bumpa updated_at para um horário POSTERIOR a esse nowMs -- o
// check de cache (pdf_generated_at >= updated_at) então dá falso na próxima
// leitura, e o PDF recém-gerado (que não inclui essa edição) é tratado como
// stale e reconvertido no próximo export. O residual é só uma conversão
// desperdiçada; nenhum PDF desatualizado chega a ser servido como "fresh".
import { DocActionError, PDF_BUCKET } from "./errors.ts";
import { signPrintToken } from "../_shared/report-docs/print-token.ts";
import { convertUrlToPdf } from "../_shared/report-template/pdf-url.ts";

// v3 (2026-08-24): override do pin de overflow do style.css na página de
// impressão — sem ele o Chromium imprimia UMA página só (caixa de rolagem
// monolítica) e descartava o resto do relatório. v2 no mesmo dia: margens
// zeradas + @page + temas. Bump invalida PDFs cacheados da geometria antiga.
export const PDF_RENDERER_VERSION = 3;
const PRINT_TOKEN_TTL_S = 600;
const SIGNED_URL_TTL_S = 3600;

export interface PdfDeps {
  convert: typeof convertUrlToPdf;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) =>
        Promise<{ error: { message: string } | null }>;
      createSignedUrl: (path: string, ttl: number) =>
        Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
  now: () => Date;
  env: { gotenbergUrl: string; printBase: string; internalSecret: string };
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function exportReportPdf(
  db: Db,
  deps: PdfDeps,
  contaId: string,
  docId: string,
): Promise<{ url: string }> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, status, updated_at, pdf_storage_path, pdf_generated_at, pdf_renderer_version")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId || doc.status !== "ready") {
    throw new DocActionError("not_found");
  }

  const bucket = deps.storage.from(PDF_BUCKET);
  const cacheFresh = doc.pdf_storage_path &&
    doc.pdf_generated_at &&
    new Date(doc.pdf_generated_at).getTime() >= new Date(doc.updated_at).getTime() &&
    doc.pdf_renderer_version === PDF_RENDERER_VERSION;
  if (cacheFresh) {
    const { data: signed, error } = await bucket.createSignedUrl(doc.pdf_storage_path, SIGNED_URL_TTL_S);
    if (!error && signed?.signedUrl) return { url: signed.signedUrl };
    // objeto sumiu do bucket: cai no caminho de regeneração
  }

  const { gotenbergUrl, printBase, internalSecret } = deps.env;
  if (!gotenbergUrl || !printBase || !internalSecret) {
    throw new DocActionError("pdf_not_configured");
  }

  const nowMs = deps.now().getTime();
  const token = await signPrintToken(docId, Math.floor(nowMs / 1000) + PRINT_TOKEN_TTL_S, internalSecret);
  const pageUrl = `${printBase.replace(/\/$/, "")}/relatorios/print/${docId}?pt=${encodeURIComponent(token)}`;

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await deps.convert(pageUrl, gotenbergUrl);
  } catch (err) {
    console.error("[report-docs] conversão de PDF falhou:", err);
    throw new DocActionError("pdf_failed");
  }

  const path = `docs/${doc.conta_id}/${doc.id}.pdf`;
  const { error: upError } = await bucket.upload(path, pdfBytes, {
    contentType: "application/pdf", upsert: true,
  });
  if (upError) {
    console.error("[report-docs] upload do PDF falhou:", upError.message);
    throw new DocActionError("pdf_failed");
  }

  const { error: updError } = await db.from("report_documents").update({
    pdf_storage_path: path,
    pdf_generated_at: new Date(nowMs).toISOString(),
    pdf_renderer_version: PDF_RENDERER_VERSION,
  }).eq("id", docId);
  if (updError) throw new Error(`pdf metadata update failed: ${updError.message}`);

  const { data: signed, error: signError } = await bucket.createSignedUrl(path, SIGNED_URL_TTL_S);
  if (signError || !signed?.signedUrl) throw new DocActionError("pdf_failed");
  return { url: signed.signedUrl };
}
