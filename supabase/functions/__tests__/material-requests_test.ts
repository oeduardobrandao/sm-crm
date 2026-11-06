import { assert, assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");
import { loadMaterialSummary, normalizeMaterialItems, saveMaterialRequest } from "../_shared/material-requests.ts";
import {
  finalizeReferenceFile,
  insertReferenceLink,
  mapReferenceRpcError,
  referenceError,
  type ReferenceErrorCode,
} from "../_shared/post-references.ts";

const CODES: [ReferenceErrorCode, number][] = [
  ["item_required", 409], ["request_closed", 409], ["nothing_sent", 409], ["too_many_items", 409],
  ["items_required", 400], ["post_not_requestable", 409], ["invalid_item", 400],
];

Deno.test("códigos novos: status e mapeamento de RAISE", () => {
  for (const [code, status] of CODES) {
    assertEquals(referenceError(code).status, status);
    const r = mapReferenceRpcError({ message: code }, "t");
    assertEquals(r.status, status);
    assertEquals(r.body, { error: code });
  }
});

Deno.test("normalizeMaterialItems", () => {
  const eleven = Array.from({ length: 11 }, () => ({ label: "a" }));
  assertEquals(normalizeMaterialItems(eleven), { ok: false, code: "too_many_items" });
  assertEquals(normalizeMaterialItems([{ label: " \t\n " }]), { ok: false, code: "invalid_item" });
  assertEquals(normalizeMaterialItems([{ label: "x".repeat(121) }]), { ok: false, code: "invalid_item" });
  assertEquals(normalizeMaterialItems("x"), { ok: false, code: "invalid_item" });
  assertEquals(normalizeMaterialItems([{ label: "a", detail: "x".repeat(301) }]), { ok: false, code: "invalid_item" });
  assertEquals(normalizeMaterialItems([{ label: "a", id: 0 }]), { ok: false, code: "invalid_item" });
  assertEquals(normalizeMaterialItems([{ label: "a", id: 1 }, { label: "b", id: 1 }]), { ok: false, code: "invalid_item" });
  const ok = normalizeMaterialItems([{ id: 3, label: "\t Foto \n", detail: "" }, { label: "b", detail: " x " }]);
  assertEquals(ok, { ok: true, items: [{ label: "Foto", detail: null, id: 3 }, { label: "b", detail: "x" }] });
  assertEquals(normalizeMaterialItems([{ label: "x".repeat(120) }]).ok, true);
});

Deno.test("saveMaterialRequest: NULL do banco vira request null; erro é mapeado", async () => {
  const db = (res: unknown) => ({ from: () => null, rpc: () => Promise.resolve(res) });
  const none = await saveMaterialRequest(db({ data: null, error: null }), {
    conta_id: "c", post_id: 1, user_id: "u", open: false, items: [],
  });
  assertEquals(none, { ok: true, request: null });
  const bad = await saveMaterialRequest(db({ data: null, error: { message: "post_not_requestable" } }), {
    conta_id: "c", post_id: 1, user_id: "u", open: true, items: [],
  });
  assert(!bad.ok && bad.result.status === 409);
});

Deno.test("loadMaterialSummary: lista vazia não chama o banco", async () => {
  const db = { from: () => null, rpc: () => { throw new Error("no call"); } };
  assertEquals(await loadMaterialSummary(db, "c", []), []);
});

Deno.test("material_item_id inválido vira invalid_item; válido segue ao RPC", async () => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    from: () => null,
    rpc: (_n: string, params: Record<string, unknown>) => {
      calls.push(params);
      return { single: () => Promise.resolve({ data: { id: 9, created_at: "t", url: "https://a.com", link_title: null, note: null }, error: null }) };
    },
  };
  const sign = async (k: string) => k;
  const base = { db, conta_id: "c", cliente_id: 1, post_id: 2, signGetUrl: sign };
  const bad = await insertReferenceLink({ ...base, input: { url: "https://a.com", material_item_id: "abc" } });
  assertEquals(bad.body, { error: "invalid_item" });
  const badFile = await finalizeReferenceFile({
    ...base, headObject: async () => null,
    input: { mime_type: "application/pdf", size_bytes: 10, r2_key: "contas/c/files/00000000-0000-0000-0000-000000000000.pdf", material_item_id: -1 },
  });
  assertEquals(badFile.body, { error: "invalid_item" });
  const ok = await insertReferenceLink({ ...base, input: { url: "https://a.com", material_item_id: 5 } });
  assertEquals(ok.status, 201);
  assertEquals((calls[0].p as Record<string, unknown>).material_item_id, 5);
  assertEquals((ok.body.item as { material_item_id: number }).material_item_id, 5);
});
