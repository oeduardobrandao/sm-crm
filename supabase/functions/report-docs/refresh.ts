// POST /:id/refresh-data (spec §5): re-snapshot de dados + branding mantendo o
// layout. ai_content e blocos de texto NÃO são tocados; o updated_at bumpa via
// trigger (data_snapshot muda), o que corretamente invalida o cache do PDF.
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { DocActionError, GenerateError } from "./errors.ts";
import { loadClientSnapshot, type SnapshotDeps } from "./snapshot-source.ts";
import {
  INSTAGRAM_SECTION_KEYS, type ReportDocSnapshot,
} from "../_shared/report-docs/snapshot.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function refreshReportDocument(
  db: Db,
  deps: SnapshotDeps,
  contaId: string,
  docId: string,
): Promise<void> {
  const { data: doc } = await db.from("report_documents")
    .select("id, conta_id, client_id, period_start, data_snapshot, instagram_account_id, tiktok_account_id")
    .eq("id", docId).maybeSingle();
  if (!doc || doc.conta_id !== contaId) throw new DocActionError("not_found");

  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, especialidade, nome, foto_url")
    .eq("id", doc.client_id).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new DocActionError("not_found");

  const month = String(doc.period_start).slice(0, 7);
  // Recarrega as duas redes (spec 2026-10-28 §B3), TikTok só com feature_tiktok, como no generate.
  const tiktokEnabled = await effectivePlanFeature(db, contaId, "feature_tiktok");
  let loaded;
  try {
    loaded = await loadClientSnapshot(
      db, deps, contaId,
      {
        id: cliente.id, especialidade: cliente.especialidade, nome: cliente.nome,
        foto_url: cliente.foto_url,
      },
      month,
      { tiktokEnabled },
    );
  } catch (err) {
    if (err instanceof GenerateError) throw new DocActionError("not_found", err.message);
    throw err;
  }

  const next = carryOverFrozenPlatforms(doc, loaded);
  const { error } = await db.from("report_documents")
    .update(next).eq("id", docId);
  if (error) throw new Error(`refresh update failed: ${error.message}`);
}

type StoredDoc = {
  data_snapshot?: ReportDocSnapshot | null;
  instagram_account_id?: string | null;
  tiktok_account_id?: string | null;
};
type Loaded = { snapshot: ReportDocSnapshot; igAccountId: string | null; tiktokAccountId: string | null };

/** Refresh só refaz as redes AINDA conectadas. Uma rede que tinha números congelados no
 * documento e saiu (desconectada, ou TikTok sem feature_tiktok) mantém a seção guardada e a
 * coluna de conta guardada, em vez de virar "sem dados". Rede conectada (ou trocada) depois da
 * geração passa a ser registrada. Nenhuma das duas conectada já falhou antes, com not_found. */
export function carryOverFrozenPlatforms(doc: StoredDoc, loaded: Loaded) {
  const prev = doc.data_snapshot ?? null;
  let snapshot = loaded.snapshot;
  let instagramAccountId = loaded.igAccountId;
  let tiktokAccountId = loaded.tiktokAccountId;

  const prevHasInstagram = !!prev && prev.instagram_connected !== false && !!prev.account?.handle;
  if (!loaded.igAccountId && prevHasInstagram) {
    const frozen: Record<string, unknown> = {};
    for (const key of INSTAGRAM_SECTION_KEYS) frozen[key] = prev[key];
    snapshot = {
      ...snapshot,
      ...frozen,
      // Snapshots antigos não têm o campo (ausente = true); aqui ele precisa ser explícito.
      instagram_connected: true,
      account: {
        ...snapshot.account,
        handle: prev.account.handle,
        profile_picture_url: snapshot.account.profile_picture_url ?? prev.account.profile_picture_url ?? null,
      },
    };
    instagramAccountId = doc.instagram_account_id ?? null;
  }

  if (!loaded.tiktokAccountId && prev?.tiktok) {
    snapshot = { ...snapshot, tiktok: prev.tiktok };
    tiktokAccountId = doc.tiktok_account_id ?? null;
  }

  return {
    data_snapshot: snapshot,
    instagram_account_id: instagramAccountId,
    tiktok_account_id: tiktokAccountId,
  };
}
