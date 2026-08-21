// DELETE /:id (spec §5): remove o objeto PDF e a linha. Deleção SÓ por aqui
// (authenticated não tem grant de DELETE), para não deixar PDF órfão; órfão
// residual de crash entre os dois passos é aceito até a varredura do deprecate.
import { DocActionError, PDF_BUCKET } from "./errors.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function deleteReportDocument(
  db: Db,
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<{ error: { message: string } | null }> } },
  contaId: string,
  docId: string,
): Promise<void> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, pdf_storage_path")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId) throw new DocActionError("not_found");

  if (doc.pdf_storage_path) {
    const { error } = await storage.from(PDF_BUCKET).remove([doc.pdf_storage_path]);
    if (error) console.warn(`[report-docs] remoção do PDF falhou (segue o delete): ${error.message}`);
  }
  const { error: delError } = await db.from("report_documents").delete().eq("id", docId);
  if (delError) throw new Error(`delete failed: ${delError.message}`);
}
