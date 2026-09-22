import { TextReader, ZipWriter } from "npm:@zip.js/zip.js@2";
import { chunk } from "../_shared/paginate.ts";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FOLDER_DEPTH,
  MAX_ZIP_FOLDERS,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TOTAL_BYTES,
  sanitizeZipPath,
  STALL_IDLE_MS,
} from "./utils.ts";

export { MAX_FOLDER_DEPTH };

export interface FileZipDeps {
  db: {
    // deno-lint-ignore no-explicit-any
    from(table: string): any;
  };
  contaId: string;
  // Returns the object stream or null (missing). index.ts wires the signed
  // streaming getter (_shared/r2.ts getObjectStreamSigned).
  getObjectStream: (key: string) => Promise<ReadableStream<Uint8Array> | null>;
  /** Overrides STALL_IDLE_MS -- tests only, keeps the stall-guard test fast. */
  stallIdleMs?: number;
}

export interface ZipPlanEntry {
  name: string;
  r2Key: string;
  path: string;
  size_bytes: number | null;
}

export interface FolderCollectResult {
  entries: ZipPlanEntry[];
  /** Subtrees the walk did NOT descend into (depth cap). Fed into the zip's
   * LEIA-ME manifest so a deep tree yields a zip that SAYS what it omitted
   * instead of a silently short one. */
  skippedPaths: string[];
}

/** Thrown as soon as a collection pass exceeds the export budget, so a huge
 * folder is refused after ~one page past the cap instead of being fully
 * paged into memory first (the edge worker has 256MB total). index.ts maps
 * it to the same 413 as checkZipBudget. */
export class ZipBudgetExceededError extends Error {
  constructor() {
    super(ZIP_TOO_LARGE_ERROR);
    this.name = "ZipBudgetExceededError";
  }
}

/** Walks a folder tree, resolving every nested file into a flat entry list.
 * Both file and subfolder pages use an id-keyset page loop so (a) the
 * entry/size budget is enforced AFTER EVERY PAGE -- collection stops at most
 * one page past the cap instead of paging an arbitrarily large folder into
 * memory before checkZipBudget ever runs -- and (b) a row deleted from an
 * earlier page mid-collection can't shift an offset window and silently drop
 * a still-existing row. MAX_ZIP_FOLDERS bounds the traversal itself (empty
 * folders never trip the file budget). Descent stops at MAX_FOLDER_DEPTH
 * (root = depth 0, matching file-manage's copyFolderRecursive); a capped
 * subtree is recorded in skippedPaths, never silently dropped. */
export async function collectFolderEntries(
  deps: FileZipDeps,
  folderId: number,
): Promise<FolderCollectResult> {
  const entries: ZipPlanEntry[] = [];
  const skippedPaths: string[] = [];
  let totalBytes = 0;

  const assertBudget = () => {
    if (entries.length > MAX_ZIP_ENTRIES || totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new ZipBudgetExceededError();
    }
  };

  let foldersVisited = 0;

  async function walkFolder(fId: number, pathPrefix: string, depth: number) {
    if (depth > MAX_FOLDER_DEPTH) {
      console.error(`[file-zip] Depth limit exceeded for folder ${fId}`);
      skippedPaths.push(`${pathPrefix}** (subpasta alem do limite de profundidade)`);
      return;
    }
    // Traversal budget independent of the FILE budget: a wide tree of empty
    // folders never trips assertBudget, so without this a pathological tree
    // could keep the walk issuing queries until the worker dies.
    if (++foldersVisited > MAX_ZIP_FOLDERS) throw new ZipBudgetExceededError();

    // Keyset pagination (id cursor), not offset: a file deleted from an
    // earlier page mid-collection shifts an offset window and silently drops
    // a still-existing row from the zip (the exact race documented on
    // fetchAllRows in _shared/paginate.ts). The id seek can only ever
    // re-serve or skip DELETED rows, never live ones.
    const PAGE = 1000;
    let lastFileId = 0;
    while (true) {
      const { data, error } = await deps.db
        .from("files")
        .select("id, name, r2_key, size_bytes")
        .eq("folder_id", fId)
        .eq("conta_id", deps.contaId)
        .gt("id", lastFileId)
        .order("id")
        .limit(PAGE);
      if (error) {
        throw new Error(`[file-zip] collectFolderEntries files page failed: ${error.message}`);
      }
      const rows = (data ?? []) as {
        id: number;
        name: string;
        r2_key: string;
        size_bytes: number | null;
      }[];
      if (rows.length === 0) break;
      for (const f of rows) {
        entries.push({
          name: f.name,
          r2Key: f.r2_key,
          path: pathPrefix + sanitizeZipPath(f.name),
          size_bytes: f.size_bytes ?? null,
        });
        // Same null-size convention as checkZipBudget: count unknown as the
        // per-file max so a legacy row can't sneak the total past the cap.
        totalBytes += f.size_bytes ?? MAX_FILE_SIZE_BYTES;
      }
      const newLast = rows[rows.length - 1].id;
      if (newLast <= lastFileId) {
        throw new Error("[file-zip] collectFolderEntries file cursor did not advance");
      }
      lastFileId = newLast;
      assertBudget();
    }

    // Same keyset cursor for subfolder pages, processed page by page: the
    // sibling set is never fully retained, so a wide level costs one page of
    // memory at a time (the MAX_ZIP_FOLDERS budget above bounds the total).
    let lastFolderId = 0;
    while (true) {
      const { data, error } = await deps.db
        .from("folders")
        .select("id, name")
        .eq("parent_id", fId)
        .eq("conta_id", deps.contaId)
        .gt("id", lastFolderId)
        .order("id")
        .limit(PAGE);
      if (error) {
        throw new Error(`[file-zip] collectFolderEntries folders page failed: ${error.message}`);
      }
      const subs = (data ?? []) as { id: number; name: string }[];
      if (subs.length === 0) break;
      for (const sub of subs) {
        await walkFolder(sub.id, pathPrefix + sanitizeZipPath(sub.name) + "/", depth + 1);
      }
      const newLast = subs[subs.length - 1].id;
      if (newLast <= lastFolderId) {
        throw new Error("[file-zip] collectFolderEntries folder cursor did not advance");
      }
      lastFolderId = newLast;
    }
  }

  await walkFolder(folderId, "", 0);
  return { entries, skippedPaths };
}

/** Resolves an explicit set of file ids (scoped to the token's conta_id) into
 * a flat entry list. Chunks the id list so a large selection never blows the
 * PostgREST URL / IN() limits, and THROWS on a query error instead of
 * silently returning fewer rows -- the previous version treated an errored
 * page as an empty page, which built a silently-empty zip. */
export async function collectFileEntries(
  deps: FileZipDeps,
  fileIds: number[],
): Promise<ZipPlanEntry[]> {
  const entries: ZipPlanEntry[] = [];
  for (const idsChunk of chunk(fileIds)) {
    const { data, error } = await deps.db
      .from("files")
      .select("name, r2_key, conta_id, size_bytes")
      .eq("conta_id", deps.contaId)
      .in("id", idsChunk);
    if (error) {
      throw new Error(`[file-zip] collectFileEntries query failed: ${error.message}`);
    }
    for (const f of (data ?? []) as { name: string; r2_key: string; size_bytes: number | null }[]) {
      entries.push({
        name: f.name,
        r2Key: f.r2_key,
        path: sanitizeZipPath(f.name),
        size_bytes: f.size_bytes ?? null,
      });
    }
    // Same early stop as collectFolderEntries: refuse past the entry cap
    // without resolving the remaining chunks first.
    if (entries.length > MAX_ZIP_ENTRIES) throw new ZipBudgetExceededError();
  }
  return entries;
}

export type ZipBudgetResult = { ok: true } | { ok: false; error: string };

const ZIP_TOO_LARGE_ERROR = "Seleção grande demais para exportar em um único zip";

/** Pre-flight refusal check run BEFORE any stream starts. A file with a null
 * size_bytes counts as MAX_FILE_SIZE_BYTES in the total (defense for legacy
 * rows; the files.size_bytes column is NOT NULL by schema). */
export function checkZipBudget(entries: ZipPlanEntry[]): ZipBudgetResult {
  if (entries.length > MAX_ZIP_ENTRIES) {
    return { ok: false, error: ZIP_TOO_LARGE_ERROR };
  }
  const total = entries.reduce((sum, e) => sum + (e.size_bytes ?? MAX_FILE_SIZE_BYTES), 0);
  if (total > MAX_ZIP_TOTAL_BYTES) {
    return { ok: false, error: ZIP_TOO_LARGE_ERROR };
  }
  return { ok: true };
}

/** Errors the wrapped stream if no chunk arrives within idleMs of the last
 * one (or of stream start). Guards against an R2 body that stops delivering
 * mid-transfer without ever closing or erroring on its own -- a plain
 * `pipeTo` would hang the whole zip (and the client's download) forever. */
export function withStallGuard(
  stream: ReadableStream<Uint8Array>,
  idleMs: number,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout>;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        timer = setTimeout(() => controller.error(new Error("object stream stalled")), idleMs);
      },
      transform(chunk, controller) {
        clearTimeout(timer);
        timer = setTimeout(() => controller.error(new Error("object stream stalled")), idleMs);
        controller.enqueue(chunk);
      },
      flush() {
        clearTimeout(timer);
      },
    }),
  );
}

/** Builds the zip response body stream from a resolved entry list.
 *
 * Every entry is streamed straight from R2 into the zip (store mode, level:
 * 0 -- media is already compressed, so deflating it would only cost CPU and
 * buffering for no size win). A failure to fetch or add ANY entry before
 * `zipWriter.add` actually starts writing is recorded in `skipped[]` and the
 * loop continues; those paths are listed in a trailing LEIA-ME manifest so
 * the user knows what's missing instead of silently getting a short zip.
 *
 * A rejection from `zipWriter.add` itself (e.g. the stall guard firing mid
 * body) is NOT recoverable the same way: zip.js writes the local file header
 * before it has all the entry's bytes, so a caught-and-continued failure
 * there would ship a zip with a corrupted entry claiming a size it doesn't
 * have. That case aborts the writable outright so the client's download
 * fails visibly instead of completing with silently-corrupt content or
 * hanging (a bare `zipWriter.close()` after an internal add failure is not
 * guaranteed to produce a valid trailer either).
 */
const MANIFEST_FILENAME = "LEIA-ME-arquivos-faltando.txt";

export function buildZipStream(
  deps: FileZipDeps,
  entries: ZipPlanEntry[],
  /** Paths already known to be missing before streaming (e.g. depth-capped
   * subtrees from collectFolderEntries) -- listed in the manifest alongside
   * the per-entry skips below. */
  presetSkipped: string[] = [],
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const zipWriter = new ZipWriter(writable);
  const stallIdleMs = deps.stallIdleMs ?? STALL_IDLE_MS;

  (async () => {
    const skipped: string[] = [...presetSkipped];
    // Reserved up front so a selected file whose root path collides with the
    // manifest name takes the duplicate-skip path below instead of reaching
    // zipWriter.add("LEIA-ME...") and throwing a duplicate-name error there,
    // which would route through the catastrophic-abort branch.
    const seenPaths = new Set<string>([MANIFEST_FILENAME]);
    try {
      for (const entry of entries) {
        if (seenPaths.has(entry.path)) {
          console.error(`[file-zip] Skipped duplicate path: ${entry.path}`);
          skipped.push(entry.path);
          continue;
        }
        if (entry.size_bytes == null || entry.size_bytes > MAX_FILE_SIZE_BYTES) {
          console.error(`[file-zip] Skipped oversized or unknown-size object: ${entry.r2Key}`);
          skipped.push(entry.path);
          continue;
        }

        let stream: ReadableStream<Uint8Array> | null;
        try {
          stream = await deps.getObjectStream(entry.r2Key);
        } catch (err) {
          console.error(`[file-zip] Failed to fetch object: ${entry.r2Key}`, err);
          skipped.push(entry.path);
          continue;
        }
        if (!stream) {
          console.error(`[file-zip] Skipped missing object: ${entry.r2Key}`);
          skipped.push(entry.path);
          continue;
        }

        seenPaths.add(entry.path);
        // A rejection here is catastrophic (see doc comment above) and falls
        // through to the outer catch, which aborts the writable.
        await zipWriter.add(entry.path, withStallGuard(stream, stallIdleMs), { level: 0 });
      }

      if (skipped.length > 0) {
        const manifest =
          "Os arquivos abaixo nao puderam ser incluidos neste zip:\n" + skipped.join("\n") + "\n";
        await zipWriter.add(MANIFEST_FILENAME, new TextReader(manifest));
      }

      await zipWriter.close();
    } catch (err) {
      console.error("[file-zip] Zip build failed", err);
      await writable.abort(err).catch(() => {});
    }
  })();

  return readable;
}
