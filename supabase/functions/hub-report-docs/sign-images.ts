// Assinatura das imagens do relatório na leitura (spec 2026-10-02, "Hub e
// print"). O layout guarda só file_id; a chave vem de report_document_files
// JOIN files, então o conjunto assinado == o vinculado pelo trigger (mesmo
// conta_id, kind image, mime aceito) == o que bloqueia exclusão.

// deno-lint-ignore no-explicit-any
type Db = any;
export type SignFn = (r2Key: string) => Promise<string | null>;

interface Block {
  type?: unknown;
  config?: Record<string, unknown>;
  [k: string]: unknown;
}

function isImage(b: unknown): b is Block {
  return typeof b === "object" && b !== null && (b as Block).type === "image";
}

export async function signImageBlocks(
  db: Db,
  docId: string,
  layout: unknown,
  sign: SignFn | undefined,
): Promise<unknown> {
  const blocks = (layout as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks) || !blocks.some(isImage)) return layout;

  const keys = new Map<number, string>();
  if (sign) {
    const { data } = await db
      .from("report_document_files")
      .select("file_id, files(r2_key, media_lost_at)")
      .eq("report_id", docId);
    for (const row of (data ?? []) as Array<{
      file_id: number;
      files: { r2_key: string; media_lost_at: string | null } | null;
    }>) {
      if (row.files && !row.files.media_lost_at) keys.set(row.file_id, row.files.r2_key);
    }
  }

  const signed = await Promise.all(
    blocks.map(async (b) => {
      if (!isImage(b)) return b;
      const { src: _drop, ...config } = b.config ?? {};
      const key = typeof config.file_id === "number" ? keys.get(config.file_id) : undefined;
      const url = key && sign ? await sign(key).catch(() => null) : null;
      return { ...b, config: url ? { ...config, src: url } : config };
    }),
  );
  return { ...(layout as Record<string, unknown>), blocks: signed };
}
