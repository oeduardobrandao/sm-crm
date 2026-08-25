// POST /:id/refresh-data (spec §5): re-snapshot de dados + branding mantendo o
// layout. ai_content e blocos de texto NÃO são tocados; o updated_at bumpa via
// trigger (data_snapshot muda), o que corretamente invalida o cache do PDF.
import { DocActionError, GenerateError } from "./errors.ts";
import { loadClientSnapshot, type SnapshotDeps } from "./snapshot-source.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function refreshReportDocument(
  db: Db,
  deps: SnapshotDeps,
  contaId: string,
  docId: string,
): Promise<void> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, client_id, period_start")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId) throw new DocActionError("not_found");

  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, especialidade, nome")
    .eq("id", doc.client_id).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new DocActionError("not_found");

  const month = String(doc.period_start).slice(0, 7);
  let snapshot;
  try {
    ({ snapshot } = await loadClientSnapshot(
      db, deps, contaId,
      { id: cliente.id, especialidade: cliente.especialidade, nome: cliente.nome },
      month,
    ));
  } catch (err) {
    if (err instanceof GenerateError) throw new DocActionError("not_found", err.message);
    throw err;
  }

  const { error } = await db.from("report_documents")
    .update({ data_snapshot: snapshot }).eq("id", docId);
  if (error) throw new Error(`refresh update failed: ${error.message}`);
}
