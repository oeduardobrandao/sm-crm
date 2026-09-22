import { BlobReader, ZipWriter } from "npm:@zip.js/zip.js@2";
import { MAX_FILE_SIZE_BYTES, sanitizeZipPath } from "./utils.ts";

export interface FileZipDeps {
  db: {
    // deno-lint-ignore no-explicit-any
    from(table: string): any;
  };
  contaId: string;
  // Returns the object stream or null (missing). Task 8 wires _shared/r2.ts
  // getObject; Task 9 replaces the wiring with the signed streaming getter.
  getObjectStream: (key: string) => Promise<ReadableStream<Uint8Array> | null>;
}

export interface ZipPlanEntry {
  name: string;
  r2Key: string;
  path: string;
  size_bytes: number | null;
}

/** Walks a folder tree, resolving every nested file into a flat entry list. */
export async function collectFolderEntries(
  deps: FileZipDeps,
  folderId: number,
): Promise<ZipPlanEntry[]> {
  const entries: ZipPlanEntry[] = [];

  async function walkFolder(fId: number, pathPrefix: string) {
    const { data: files } = await deps.db
      .from("files")
      .select("name, r2_key, size_bytes")
      .eq("folder_id", fId)
      .eq("conta_id", deps.contaId);
    for (const f of files ?? []) {
      entries.push({
        name: f.name,
        r2Key: f.r2_key,
        path: pathPrefix + sanitizeZipPath(f.name),
        size_bytes: f.size_bytes ?? null,
      });
    }
    const { data: subs } = await deps.db
      .from("folders")
      .select("id, name")
      .eq("parent_id", fId)
      .eq("conta_id", deps.contaId);
    for (const sub of subs ?? []) {
      await walkFolder(sub.id, pathPrefix + sanitizeZipPath(sub.name) + "/");
    }
  }

  await walkFolder(folderId, "");
  return entries;
}

/** Resolves an explicit set of file ids (scoped to the token's conta_id) into a flat entry list. */
export async function collectFileEntries(
  deps: FileZipDeps,
  fileIds: number[],
): Promise<ZipPlanEntry[]> {
  const { data: files } = await deps.db
    .from("files")
    .select("name, r2_key, conta_id, size_bytes")
    .eq("conta_id", deps.contaId)
    .in("id", fileIds);

  return (files ?? []).map((f: { name: string; r2_key: string; size_bytes: number | null }) => ({
    name: f.name,
    r2Key: f.r2_key,
    path: sanitizeZipPath(f.name),
    size_bytes: f.size_bytes ?? null,
  }));
}

/** Builds the zip response body stream from a resolved entry list. */
export function buildZipStream(
  deps: FileZipDeps,
  entries: ZipPlanEntry[],
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const zipWriter = new ZipWriter(writable);

  (async () => {
    for (const entry of entries) {
      if (entry.size_bytes && entry.size_bytes > MAX_FILE_SIZE_BYTES) continue;
      try {
        const stream = await deps.getObjectStream(entry.r2Key);
        if (!stream) {
          console.error(`[file-zip] Skipped missing object: ${entry.r2Key}`);
          continue;
        }
        const blob = await new Response(stream).blob();
        await zipWriter.add(entry.path, new BlobReader(blob));
      } catch (err) {
        console.error(`[file-zip] Skipped failed object: ${entry.r2Key}`, err);
      }
    }
    await zipWriter.close();
  })();

  return readable;
}
