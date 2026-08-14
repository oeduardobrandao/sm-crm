import { assert, assertEquals } from "./assert.ts";
import {
  matchesKeywords, normalizeForMatch, pickWinner,
} from "../_shared/instagram-comment-matching.ts";

Deno.test("normaliza acentos e caixa", () => {
  assertEquals(normalizeForMatch("ÉBOOK Grátis"), "ebook gratis");
});

Deno.test("casa palavra inteira, não substring", () => {
  assert(matchesKeywords("quero a promo!", ["promo"]));
  assert(matchesKeywords("PROMO", ["promo"]));
  assert(matchesKeywords("mande o ébook", ["ebook"]));
  assert(!matchesKeywords("assumi um compromisso", ["promo"]));
  assert(!matchesKeywords("promoção imperdível", ["promo"]));
});

Deno.test("keyword com espaços vira frase", () => {
  assert(matchesKeywords("EU QUERO muito", ["eu quero"]));
  assert(!matchesKeywords("eu não quero", ["eu quero"]));
});

Deno.test("qualquer keyword da lista dispara; lista vazia nunca", () => {
  assert(matchesKeywords("link por favor", ["promo", "link"]));
  assert(!matchesKeywords("link por favor", []));
});

Deno.test("desempate: específico > global, depois created_at ASC, id ASC", () => {
  const base = { conta_id: "w1", client_id: 1 };
  const globalOld = { ...base, id: "b", ig_media_id: null, created_at: "2026-01-01T00:00:00Z" };
  const specificNew = { ...base, id: "c", ig_media_id: "m1", created_at: "2026-06-01T00:00:00Z" };
  const specificOld = { ...base, id: "a", ig_media_id: "m1", created_at: "2026-01-01T00:00:00Z" };
  assertEquals(pickWinner([globalOld, specificNew, specificOld])?.id, "a");
  assertEquals(pickWinner([globalOld])?.id, "b");
  assertEquals(pickWinner([]), null);
});
