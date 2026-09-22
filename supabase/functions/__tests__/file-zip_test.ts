import { assert, assertEquals } from "./assert.ts";
import { Uint8ArrayReader, ZipReader } from "npm:@zip.js/zip.js@2";
import {
  buildZipStream,
  collectFileEntries,
  collectFolderEntries,
  type FileZipDeps,
} from "../file-zip/handler.ts";

type Row = Record<string, unknown>;

/**
 * Minimal structural fake of the two tables `handler.ts` touches (`files`,
 * `folders`), mirroring the `.select().eq().eq()` / `.select().eq().in()`
 * chains the handler actually issues -- not a generic PostgREST emulator
 * like `ExpressPostCleanupDb`'s, since file-zip only ever filters by
 * equality or membership.
 */
function makeFakeDb(tables: { files: Row[]; folders: Row[] }): FileZipDeps["db"] {
  return {
    from(table: string) {
      const rows = (tables as Record<string, Row[]>)[table] ?? [];
      const filters: Array<{ column: string; kind: "eq" | "in"; value: unknown }> = [];
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
        then(onFulfilled: (v: { data: Row[] | null; error: null }) => unknown) {
          const data = rows.filter((r) =>
            filters.every((f) =>
              f.kind === "eq" ? r[f.column] === f.value : (f.value as unknown[]).includes(r[f.column])
            )
          );
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
    assertEquals(names, ["a.txt", "sub/nested/c.txt"]);
  },
});
