import { assertEquals } from "./assert.ts";
import {
  MAX_PUBLIC_REPLIES,
  parsePublicReplies,
  pickPublicReply,
} from "../_shared/instagram-public-replies.ts";

Deno.test("parsePublicReplies: array válido passa direto", () => {
  assertEquals(parsePublicReplies(["a", "b"], null), ["a", "b"]);
});

Deno.test("parsePublicReplies: null/undefined caem no legado", () => {
  assertEquals(parsePublicReplies(null, "legado"), ["legado"]);
  assertEquals(parsePublicReplies(undefined, "legado"), ["legado"]);
});

Deno.test("parsePublicReplies: array vazio cai no legado; legado vazio/espaços vira []", () => {
  assertEquals(parsePublicReplies([], "legado"), ["legado"]);
  assertEquals(parsePublicReplies([], "   "), []);
  assertEquals(parsePublicReplies([], null), []);
});

Deno.test("parsePublicReplies: fail-open descarta itens malformados sem lançar", () => {
  assertEquals(parsePublicReplies(["ok", 7, "  ", null], null), ["ok"]);
  assertEquals(parsePublicReplies("não-array", "legado"), ["legado"]);
});

Deno.test("parsePublicReplies: corta acima de MAX_PUBLIC_REPLIES", () => {
  const seven = ["1", "2", "3", "4", "5", "6", "7"];
  assertEquals(parsePublicReplies(seven, null).length, MAX_PUBLIC_REPLIES);
});

Deno.test("pickPublicReply: determinístico via random injetado; [] devolve null", () => {
  assertEquals(pickPublicReply(["a", "b", "c"], () => 0), "a");
  assertEquals(pickPublicReply(["a", "b", "c"], () => 0.99), "c");
  assertEquals(pickPublicReply([], () => 0), null);
});
