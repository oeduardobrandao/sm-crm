import { assert, assertEquals } from "./assert.ts";
import { TextReader, TextWriter, Uint8ArrayReader, ZipReader } from "npm:@zip.js/zip.js@2";
import {
  buildZipStream,
  checkZipBudget,
  collectFileEntries,
  collectFolderEntries,
  MAX_FOLDER_DEPTH,
  type FileZipDeps,
  type ZipPlanEntry,
} from "../file-zip/handler.ts";
import { MAX_FILE_SIZE_BYTES, MAX_ZIP_TOTAL_BYTES } from "../file-zip/utils.ts";

type Row = Record<string, unknown>;

/**
 * Minimal structural fake of the two tables `handler.ts` touches (`files`,
 * `folders`), mirroring the `.select().eq().eq().order().range()` /
 * `.select().eq().in()` chains the handler actually issues -- not a generic
 * PostgREST emulator like `ExpressPostCleanupDb`'s, since file-zip only ever
 * filters by equality or membership. `order()`/`range()` are needed because
 * Task 9 drives both walk queries through `fetchAllRows`.
 */
function makeFakeDb(tables: { files: Row[]; folders: Row[] }): FileZipDeps["db"] {
  return {
    from(table: string) {
      const rows = (tables as Record<string, Row[]>)[table] ?? [];
      const filters: Array<{ column: string; kind: "eq" | "in"; value: unknown }> = [];
      let orderCol: string | null = null;
      let rangeFrom: number | null = null;
      let rangeTo: number | null = null;
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, kind: "eq", value });
          return chain;
        },
        in(column: string, values: unknown[]) {
          filters.push({ column, kind: "in", value: values });
          return chain;
        },
        order(column: string) {
          orderCol = column;
          return chain;
        },
        range(from: number, to: number) {
          rangeFrom = from;
          rangeTo = to;
          return chain;
        },
        then(onFulfilled: (v: { data: Row[] | null; error: null }) => unknown) {
          let data = rows.filter((r) =>
            filters.every((f) =>
              f.kind === "eq" ? r[f.column] === f.value : (f.value as unknown[]).includes(r[f.column])
            )
          );
          if (orderCol) {
            const col = orderCol;
            data = [...data].sort((a, b) => {
              const av = a[col] as number;
              const bv = b[col] as number;
              return av < bv ? -1 : av > bv ? 1 : 0;
            });
          }
          if (rangeFrom !== null && rangeTo !== null) {
            data = data.slice(rangeFrom, rangeTo + 1);
          }
          return Promise.resolve(onFulfilled({ data, error: null }));
        },
      };
      return chain;
    },
  };
}

/** Small in-memory object store standing in for R2. */
function makeFakeGetObjectStream(objects: Record<string, Uint8Array>): FileZipDeps["getObjectStream"] {
  return (key: string) => {
    const bytes = objects[key];
    if (!bytes) return Promise.resolve(null);
    return Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
  };
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 2-level folder tree under folder id 1:
 *   1 (root)
 *   +-- a.txt
 *   +-- sub (folder id 2)
 *       +-- b.txt
 *       +-- nested (folder id 3)
 *           +-- c.txt
 */
function makeTree() {
  const folders: Row[] = [
    { id: 1, name: "root", parent_id: null, conta_id: "conta-1" },
    { id: 2, name: "sub", parent_id: 1, conta_id: "conta-1" },
    { id: 3, name: "nested", parent_id: 2, conta_id: "conta-1" },
  ];
  const files: Row[] = [
    { id: 10, name: "a.txt", r2_key: "r2/a", size_bytes: 3, folder_id: 1, conta_id: "conta-1" },
    { id: 11, name: "b.txt", r2_key: "r2/b", size_bytes: 3, folder_id: 2, conta_id: "conta-1" },
    { id: 12, name: "c.txt", r2_key: "r2/c", size_bytes: 3, folder_id: 3, conta_id: "conta-1" },
  ];
  return { folders, files };
}

Deno.test("collectFolderEntries returns 3 entries with correct nested paths", async () => {
  const { folders, files } = makeTree();
  const deps: FileZipDeps = {
    db: makeFakeDb({ files, folders }),
    contaId: "conta-1",
    getObjectStream: makeFakeGetObjectStream({}),
  };

  const entries = await collectFolderEntries(deps, 1);

  assertEquals(entries.length, 3);
  const paths = entries.map((e) => e.path).sort();
  assertEquals(paths, ["a.txt", "sub/b.txt", "sub/nested/c.txt"]);
});

Deno.test("collectFolderEntries scopes to conta_id", async () => {
  const { folders, files } = makeTree();
  files.push({ id: 99, name: "other.txt", r2_key: "r2/other", size_bytes: 1, folder_id: 1, conta_id: "conta-2" });
  const deps: FileZipDeps = {
    db: makeFakeDb({ files, folders }),
    contaId: "conta-1",
    getObjectStream: makeFakeGetObjectStream({}),
  };

  const entries = await collectFolderEntries(deps, 1);

  assertEquals(entries.length, 3);
  assert(!entries.some((e) => e.name === "other.txt"));
});

Deno.test("collectFileEntries resolves explicit file ids scoped to conta_id", async () => {
  const { folders, files } = makeTree();
  const deps: FileZipDeps = {
    db: makeFakeDb({ files, folders }),
    contaId: "conta-1",
    getObjectStream: makeFakeGetObjectStream({}),
  };

  const entries = await collectFileEntries(deps, [10, 12]);

  assertEquals(entries.length, 2);
  assertEquals(entries.map((e) => e.path).sort(), ["a.txt", "c.txt"]);
});

Deno.test({
  name: "buildZipStream produces a parseable zip containing the 3 nested paths",
  // zip.js's default deflate path spins up a Web Worker / timer that outlives
  // this test's synchronous assertions; it's a zip.js internal, not a leak
  // introduced by this handler, so the resource/op sanitizers are disabled
  // for these two zip-building tests only.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { folders, files } = makeTree();
    const objects: Record<string, Uint8Array> = {
      "r2/a": new TextEncoder().encode("aaa"),
      "r2/b": new TextEncoder().encode("bbb"),
      "r2/c": new TextEncoder().encode("ccc"),
    };
    const deps: FileZipDeps = {
      db: makeFakeDb({ files, folders }),
      contaId: "conta-1",
      getObjectStream: makeFakeGetObjectStream(objects),
    };

    const entries = await collectFolderEntries(deps, 1);
    const stream = buildZipStream(deps, entries);
    const zipBytes = await collectStream(stream);

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const zipEntries = await zipReader.getEntries();
    await zipReader.close();

    const names = zipEntries.map((e) => e.filename).sort();
    assertEquals(names, ["a.txt", "sub/b.txt", "sub/nested/c.txt"]);
  },
});

Deno.test({
  name: "buildZipStream skips a missing object and still closes the zip",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { folders, files } = makeTree();
    const objects: Record<string, Uint8Array> = {
      "r2/a": new TextEncoder().encode("aaa"),
      // "r2/b" intentionally missing
      "r2/c": new TextEncoder().encode("ccc"),
    };
    const deps: FileZipDeps = {
      db: makeFakeDb({ files, folders }),
      contaId: "conta-1",
      getObjectStream: makeFakeGetObjectStream(objects),
    };

    const entries = await collectFolderEntries(deps, 1);
    const stream = buildZipStream(deps, entries);
    const zipBytes = await collectStream(stream);

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const zipEntries = await zipReader.getEntries();
    await zipReader.close();

    const names = zipEntries.map((e) => e.filename).sort();
    assertEquals(names, ["LEIA-ME-arquivos-faltando.txt", "a.txt", "sub/nested/c.txt"]);
  },
});

Deno.test({
  name: "buildZipStream streams entries without buffering and stores (level 0)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const entries: ZipPlanEntry[] = [
      { name: "big.txt", r2Key: "r2/big", path: "big.txt", size_bytes: 9 },
    ];
    // 3-chunk stream: buildZipStream must pipe it through without buffering
    // the whole object into memory first.
    const objectStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("aaa"));
        controller.enqueue(new TextEncoder().encode("bbb"));
        controller.enqueue(new TextEncoder().encode("ccc"));
        controller.close();
      },
    });
    const deps: FileZipDeps = {
      db: makeFakeDb({ files: [], folders: [] }),
      contaId: "conta-1",
      getObjectStream: (key: string) => key === "r2/big" ? Promise.resolve(objectStream) : Promise.resolve(null),
    };

    const stream = buildZipStream(deps, entries);
    const zipBytes = await collectStream(stream);

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const zipEntries = await zipReader.getEntries();
    await zipReader.close();

    assertEquals(zipEntries.length, 1);
    assertEquals(zipEntries[0].filename, "big.txt");
    assertEquals(zipEntries[0].compressionMethod, 0);
  },
});

Deno.test({
  name: "zip includes LEIA-ME manifest when an object is missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const entries: ZipPlanEntry[] = [
      { name: "present.txt", r2Key: "r2/present", path: "present.txt", size_bytes: 3 },
      { name: "gone.txt", r2Key: "r2/gone", path: "folder/gone.txt", size_bytes: 3 },
    ];
    const objects: Record<string, Uint8Array> = {
      "r2/present": new TextEncoder().encode("aaa"),
      // "r2/gone" intentionally missing -> getObjectStream resolves null
    };
    const deps: FileZipDeps = {
      db: makeFakeDb({ files: [], folders: [] }),
      contaId: "conta-1",
      getObjectStream: makeFakeGetObjectStream(objects),
    };

    const stream = buildZipStream(deps, entries);
    const zipBytes = await collectStream(stream);

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const zipEntries = await zipReader.getEntries();
    const manifestEntry = zipEntries.find((e) => e.filename === "LEIA-ME-arquivos-faltando.txt");
    assert(manifestEntry, "manifest entry missing");
    assert(!manifestEntry.directory, "manifest entry must be a file, not a directory");
    // The `!manifestEntry.directory` check above narrows the Entry union to
    // FileEntry, which is the only variant that has getData.
    const manifestText = await manifestEntry.getData(new TextWriter());
    await zipReader.close();

    const names = zipEntries.map((e) => e.filename).sort();
    assertEquals(names, ["LEIA-ME-arquivos-faltando.txt", "present.txt"]);
    assert(manifestText.startsWith("Os arquivos abaixo nao puderam ser incluidos neste zip:"));
    assert(manifestText.includes("folder/gone.txt"));
  },
});

Deno.test({
  name:
    "a selected file whose path collides with the manifest name is skipped, not a duplicate-name crash",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // The manifest name is reserved in seenPaths up front, so a user file at
    // that exact root path takes the duplicate-skip branch (and lands in the
    // manifest itself) instead of reaching zipWriter.add("LEIA-ME...") after
    // it was already used for the real manifest -- which would throw a
    // duplicate-name error from zip.js and abort the whole zip.
    const entries: ZipPlanEntry[] = [
      { name: "LEIA-ME-arquivos-faltando.txt", r2Key: "r2/collide", path: "LEIA-ME-arquivos-faltando.txt", size_bytes: 3 },
      { name: "gone.txt", r2Key: "r2/gone", path: "folder/gone.txt", size_bytes: 3 },
    ];
    const objects: Record<string, Uint8Array> = {
      "r2/collide": new TextEncoder().encode("aaa"),
      // "r2/gone" intentionally missing -> getObjectStream resolves null
    };
    const deps: FileZipDeps = {
      db: makeFakeDb({ files: [], folders: [] }),
      contaId: "conta-1",
      getObjectStream: makeFakeGetObjectStream(objects),
    };

    const stream = buildZipStream(deps, entries);
    const zipBytes = await collectStream(stream);

    const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
    const zipEntries = await zipReader.getEntries();
    const manifestEntry = zipEntries.find((e) => e.filename === "LEIA-ME-arquivos-faltando.txt");
    assert(manifestEntry, "manifest entry missing");
    assert(!manifestEntry.directory, "manifest entry must be a file, not a directory");
    const manifestText = await manifestEntry.getData(new TextWriter());
    await zipReader.close();

    // Only one entry with that name in the zip -- the build succeeded, and
    // it's the real manifest (not the user's colliding file).
    const names = zipEntries.map((e) => e.filename);
    assertEquals(names.filter((n) => n === "LEIA-ME-arquivos-faltando.txt").length, 1);
    assertEquals(names.length, 1);
    assert(manifestText.includes("LEIA-ME-arquivos-faltando.txt"), "colliding file must be listed as skipped");
    assert(manifestText.includes("folder/gone.txt"));
  },
});

Deno.test("collectFolderEntries paginates file pages and stops at depth cap", async () => {
  const folders: Row[] = [];
  const files: Row[] = [];

  // Wide folder (depth 0) with 1100 files -- exceeds the 1000-row PostgREST
  // page cap, so collectFolderEntries must page via fetchAllRows to see all
  // of them.
  folders.push({ id: 1, name: "wide", parent_id: null, conta_id: "conta-1" });
  for (let i = 0; i < 1100; i++) {
    files.push({
      id: 1000 + i,
      name: `f${i}.txt`,
      r2_key: `r2/f${i}`,
      size_bytes: 1,
      folder_id: 1,
      conta_id: "conta-1",
    });
  }

  // Chain of 11 nested folders below the root: depth 1 through depth 11.
  // MAX_FOLDER_DEPTH (10) means depth 11 must never be descended into, so
  // its file is never collected.
  let parentId = 1;
  for (let depth = 1; depth <= 11; depth++) {
    const folderId = 100 + depth;
    folders.push({ id: folderId, name: `d${depth}`, parent_id: parentId, conta_id: "conta-1" });
    files.push({
      id: 2000 + depth,
      name: `depth${depth}.txt`,
      r2_key: `r2/depth${depth}`,
      size_bytes: 1,
      folder_id: folderId,
      conta_id: "conta-1",
    });
    parentId = folderId;
  }

  const deps: FileZipDeps = {
    db: makeFakeDb({ files, folders }),
    contaId: "conta-1",
    getObjectStream: makeFakeGetObjectStream({}),
  };

  const entries = await collectFolderEntries(deps, 1);

  const wideCount = entries.filter((e) => /^f\d+\.txt$/.test(e.path)).length;
  assertEquals(wideCount, 1100);
  assertEquals(MAX_FOLDER_DEPTH, 10);
  assert(entries.some((e) => e.path.endsWith("depth10.txt")), "depth 10 should be collected");
  assert(!entries.some((e) => e.path.endsWith("depth11.txt")), "depth 11 must not be collected");
});

Deno.test("oversized total is refused before streaming", () => {
  const entries: ZipPlanEntry[] = [
    { name: "a", r2Key: "r2/a", path: "a", size_bytes: MAX_ZIP_TOTAL_BYTES },
    { name: "b", r2Key: "r2/b", path: "b", size_bytes: 10 },
  ];

  const result = checkZipBudget(entries);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error, "Seleção grande demais para exportar em um único zip");
  }
});

Deno.test("checkZipBudget treats a null size_bytes as MAX_FILE_SIZE_BYTES in the total", () => {
  const entryCount = Math.ceil(MAX_ZIP_TOTAL_BYTES / MAX_FILE_SIZE_BYTES) + 1;
  const entries: ZipPlanEntry[] = Array.from({ length: entryCount }, (_, i) => ({
    name: `f${i}`,
    r2Key: `r2/f${i}`,
    path: `f${i}`,
    size_bytes: null,
  }));

  const result = checkZipBudget(entries);

  assertEquals(result.ok, false);
});

Deno.test({
  name: "a stalled object stream errors the zip instead of hanging",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const entries: ZipPlanEntry[] = [
      { name: "stalled.txt", r2Key: "r2/stalled", path: "stalled.txt", size_bytes: 3 },
    ];
    // A stream that never produces a chunk and never closes.
    const stalledStream = new ReadableStream<Uint8Array>({
      start() {
        // never enqueue, never close
      },
    });
    const deps: FileZipDeps = {
      db: makeFakeDb({ files: [], folders: [] }),
      contaId: "conta-1",
      getObjectStream: () => Promise.resolve(stalledStream),
      stallIdleMs: 20,
    };

    const stream = buildZipStream(deps, entries);
    const reader = stream.getReader();

    let rejected = false;
    try {
      // deno-lint-ignore no-empty
      while (!(await reader.read()).done) {}
    } catch {
      rejected = true;
    }
    assert(rejected, "expected the output stream to error instead of hanging");
  },
});
