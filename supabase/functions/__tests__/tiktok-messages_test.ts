import { assertEquals } from "./assert.ts";
import {
  isTikTokCannotPostCode,
  TIKTOK_CANNOT_POST_CODES,
  TIKTOK_MSG,
  tiktokErrorMessage,
} from "../_shared/tiktok-messages.ts";

Deno.test("tiktok-messages: maps every documented code to pt-BR", () => {
  assertEquals(
    tiktokErrorMessage("spam_risk_too_many_posts"),
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  );
  assertEquals(
    tiktokErrorMessage("spam_risk_user_banned_from_posting"),
    "O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok.",
  );
  assertEquals(
    tiktokErrorMessage("reached_active_user_cap"),
    "O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde.",
  );
  assertEquals(
    tiktokErrorMessage("unaudited_client_can_only_post_to_private_accounts"),
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  );
  assertEquals(
    tiktokErrorMessage("privacy_level_option_mismatch"),
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  );
  assertEquals(
    tiktokErrorMessage("url_ownership_unverified"),
    "O TikTok não reconheceu o endereço da mídia. Fale com o suporte.",
  );
  assertEquals(tiktokErrorMessage("something_else"), null);
  assertEquals(tiktokErrorMessage(undefined), null);
});

Deno.test("tiktok-messages: can't-post codes", () => {
  assertEquals(TIKTOK_CANNOT_POST_CODES.length, 3);
  assertEquals(isTikTokCannotPostCode("reached_active_user_cap"), true);
  assertEquals(isTikTokCannotPostCode("access_token_invalid"), false);
});

Deno.test("tiktok-messages: fixed sentences, no em dashes", () => {
  assertEquals(TIKTOK_MSG.privacyMissing, "Configurações do TikTok incompletas. Abra o post e defina a privacidade.");
  assertEquals(TIKTOK_MSG.brandedPrivate, "A visibilidade de conteúdo de marca não pode ser privada.");
  assertEquals(TIKTOK_MSG.mediaLost, "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.");
  assertEquals(TIKTOK_MSG.mediaMissing, "Adicione mídia ao post para publicar no TikTok.");
  assertEquals(
    TIKTOK_MSG.publicAccountInTestMode,
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.",
  );
  assertEquals(TIKTOK_MSG.durationExceeded(750, 600), "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.");
  for (const v of Object.values(TIKTOK_MSG)) {
    const s = typeof v === "function" ? v(1, 2) : v;
    assertEquals(s.includes("—"), false, s);
  }
});
