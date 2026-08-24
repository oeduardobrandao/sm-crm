import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { deleteReportDocument } from "./delete-doc.ts";
import { DocActionError, PDF_BUCKET } from "./errors.ts";

// Fake db + fake storage próprios deste arquivo. db.from("report_documents")
// devolve { select, delete } -- delete gravado em db.deletes. storage fake
// grava toda chamada de remove() em storage.removeCalls, respondendo com
// `removeError` quando configurado (simula o bucket rejeitando a remoção).
function makeDb(row: Record<string, unknown> | null) {
  const deletes: { id: string }[] = [];
  return {
    deletes,
    from: (table: string) => {
      if (table !== "report_documents") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
        delete: () => ({
          eq: (_col: string, id: string) => {
            deletes.push({ id });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeStorage(removeError: { message: string } | null = null) {
  const removeCalls: { bucket: string; paths: string[] }[] = [];
  return {
    removeCalls,
    from: (bucket: string) => ({
      remove: (paths: string[]) => {
        removeCalls.push({ bucket, paths });
        return Promise.resolve({ error: removeError });
      },
    }),
  };
}

Deno.test("doc de outro workspace: not_found, storage.remove NÃO chamado", async () => {
  const db = makeDb({ id: "d1", conta_id: "OUTRA", pdf_storage_path: "docs/d1.pdf" });
  const storage = makeStorage();
  let err: unknown;
  try {
    await deleteReportDocument(db, storage, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assertEquals(storage.removeCalls.length, 0);
  assertEquals(db.deletes.length, 0);
});

Deno.test("doc com pdf_storage_path: storage.remove chamado no bucket certo e depois delete da linha", async () => {
  const db = makeDb({ id: "d1", conta_id: "c", pdf_storage_path: "docs/d1.pdf" });
  const storage = makeStorage();
  await deleteReportDocument(db, storage, "c", "d1");
  assertEquals(storage.removeCalls.length, 1);
  assertEquals(storage.removeCalls[0].bucket, PDF_BUCKET);
  assertEquals(storage.removeCalls[0].paths, ["docs/d1.pdf"]);
  assertEquals(db.deletes.length, 1);
  assertEquals(db.deletes[0].id, "d1");
});

Deno.test("doc sem pdf_storage_path: nenhum remove, delete da linha", async () => {
  const db = makeDb({ id: "d1", conta_id: "c", pdf_storage_path: null });
  const storage = makeStorage();
  await deleteReportDocument(db, storage, "c", "d1");
  assertEquals(storage.removeCalls.length, 0);
  assertEquals(db.deletes.length, 1);
  assertEquals(db.deletes[0].id, "d1");
});

Deno.test("storage.remove rejeita: warn e a linha AINDA é deletada (órfão aceito)", async () => {
  const db = makeDb({ id: "d1", conta_id: "c", pdf_storage_path: "docs/d1.pdf" });
  const storage = makeStorage({ message: "boom" });
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    await deleteReportDocument(db, storage, "c", "d1");
  } finally {
    console.warn = originalWarn;
  }
  assert(warned, "esperava um console.warn quando storage.remove falha");
  assertEquals(storage.removeCalls.length, 1);
  assertEquals(db.deletes.length, 1);
  assertEquals(db.deletes[0].id, "d1");
});
