// Runtime-neutral (no imports): loaded by Deno edge functions AND by the CRM through the
// `@mesaas/tiktok-messages` alias (same wiring as `@mesaas/platforms`). Spec
// 2026-10-08-tiktok-audit-readiness A6/A10.

export const TIKTOK_CANNOT_POST_CODES = [
  "spam_risk_too_many_posts",
  "spam_risk_user_banned_from_posting",
  "reached_active_user_cap",
] as const;
export type TikTokCannotPostCode = typeof TIKTOK_CANNOT_POST_CODES[number];

export function isTikTokCannotPostCode(code: unknown): code is TikTokCannotPostCode {
  return typeof code === "string" && (TIKTOK_CANNOT_POST_CODES as readonly string[]).includes(code);
}

const CODE_MESSAGES: Record<string, string> = {
  spam_risk_too_many_posts:
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  spam_risk_user_banned_from_posting:
    "O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok.",
  reached_active_user_cap:
    "O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde.",
  unaudited_client_can_only_post_to_private_accounts:
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
  privacy_level_option_mismatch:
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  url_ownership_unverified: "O TikTok não reconheceu o endereço da mídia. Fale com o suporte.",
};

export function tiktokErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  // Own keys only: a code like "constructor" must not resolve to an Object.prototype member.
  // (Not Object.hasOwn: the CRM imports this module and its tsconfig lib is ES2021.)
  return Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code) ? CODE_MESSAGES[code] : null;
}

export const TIKTOK_MSG = {
  privacyMissing: "Configurações do TikTok incompletas. Abra o post e defina a privacidade.",
  privacyMismatch: CODE_MESSAGES.privacy_level_option_mismatch,
  brandedPrivate: "A visibilidade de conteúdo de marca não pode ser privada.",
  mediaLost: "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.",
  mediaMissing: "Adicione mídia ao post para publicar no TikTok.",
  publicAccountInTestMode:
    "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.",
  durationExceeded: (seconds: number, max: number) =>
    `Este vídeo tem ${seconds}s. O máximo permitido para esta conta é ${max}s.`,
};
