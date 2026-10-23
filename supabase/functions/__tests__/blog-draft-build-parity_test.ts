// Metade Deno do teste de deriva validador × build (a outra metade é
// scripts/seo/__tests__/blog-draft-build-parity.test.ts, que lê o MESMO fixture). O validador
// daqui (zod 3) e o dbPostSchema do build (zod 4) são duas implementações: se um rascunho que
// a rotina e o Admin aceitam deixasse de passar no build, todo deploy de produção travaria no
// blog:sync. Aqui: o fixture passa no validateBlogDraft inteiro, sem normalização (o que foi
// aceito é exatamente o que vai para a linha).
import { assert, assertEquals } from "./assert.ts";
import { BLOG_DRAFT_FIELDS, validateBlogDraft } from "../_shared/blog-validate.ts";

const FIXTURE = new URL("./fixtures/blog-approved-draft.json", import.meta.url);
const BUCKET_PREFIX = "https://mesaas.supabase.co/storage/v1/object/public/blog-images/";

Deno.test("fixture de paridade: validateBlogDraft aceita o rascunho inteiro sem mudar nada", async () => {
  const draft = JSON.parse(await Deno.readTextFile(FIXTURE));
  const v = validateBlogDraft(draft, { partial: false, imageUrlPrefix: BUCKET_PREFIX });
  assert(v.ok, v.ok ? "" : v.errors.join("\n"));
  const expected = Object.fromEntries(BLOG_DRAFT_FIELDS.map((f) => [f, draft[f]]));
  assertEquals(v.value, expected);
});
