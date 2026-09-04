import { assertEquals } from "./assert.ts";
import { newImageKeys } from "../_shared/admin-popups.ts";

Deno.test("newImageKeys: retorna chaves novas sem duplicatas, ignora persistidas e input não-array", () => {
  const persisted = new Set(["contas/c1/files/a.png"]);
  const pages = [
    { image_key: "contas/c1/files/a.png" }, // já persistida: fora
    { image_key: "contas/c1/files/b.png" }, // nova
    { image_key: "contas/c1/files/b.png" }, // repetida: não duplica
    { image_key: "" }, // vazia: fora
    {}, // sem image_key: fora
  ];
  assertEquals(newImageKeys(pages, persisted), ["contas/c1/files/b.png"]);
  assertEquals(newImageKeys("not-an-array", persisted), []);
  assertEquals(newImageKeys(undefined, persisted), []);
});
