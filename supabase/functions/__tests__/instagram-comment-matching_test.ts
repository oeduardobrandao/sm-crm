import { assert, assertEquals } from "./assert.ts";
import {
  matchesKeywords, normalizeForMatch, pickWinner, targetMatches,
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

// ── targetMatches: alvo da automação (global / pendente / específico / ligado) ──

Deno.test("targetMatches: global (ambos null) casa qualquer mídia, inclusive mediaId desconhecido", () => {
  const global = { ig_media_id: null, workflow_post_id: null };
  assert(targetMatches(global, "media-1"));
  assert(targetMatches(global, null));
});

Deno.test("targetMatches: pendente (só workflow_post_id) NUNCA casa", () => {
  const pendente = { ig_media_id: null, workflow_post_id: 42 };
  assert(!targetMatches(pendente, "media-1"));
  assert(!targetMatches(pendente, null), "nem quando a mídia do comentário é desconhecida");
});

Deno.test("targetMatches: específico casa só a própria mídia, e não casa com mediaId null", () => {
  const especifico = { ig_media_id: "media-1", workflow_post_id: null };
  assert(targetMatches(especifico, "media-1"));
  assert(!targetMatches(especifico, "media-2"));
  assert(!targetMatches(especifico, null), "mídia desconhecida nunca casa alvo específico");
});

Deno.test("targetMatches: ligado (ambos set) se comporta como específico", () => {
  const ligado = { ig_media_id: "media-1", workflow_post_id: 42 };
  assert(targetMatches(ligado, "media-1"));
  assert(!targetMatches(ligado, "media-2"));
  assert(!targetMatches(ligado, null));
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
