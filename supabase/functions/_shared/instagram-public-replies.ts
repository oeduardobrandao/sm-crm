// Pool de respostas públicas da automação comentário -> DM. Módulo puro.
// Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
//
// Fail-open POR DESIGN, mesmo racional do parseDmButtons (instagram-dm-payload.ts):
// o enforcement da forma é o CHECK do banco; um throw aqui envenenaria envios.
// A janela migration -> redeploy chega com public_replies ausente (undefined),
// e automações antigas com '[]' -- nos dois casos o legado public_reply decide.

export const MAX_PUBLIC_REPLIES = 5;

export function parsePublicReplies(
  raw: unknown,
  legacy: string | null | undefined,
): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    let discarded = 0;
    for (const item of raw) {
      if (out.length >= MAX_PUBLIC_REPLIES) {
        discarded++;
        continue;
      }
      if (typeof item !== "string" || item.trim() === "") {
        discarded++;
        continue;
      }
      out.push(item);
    }
    if (discarded > 0) {
      console.warn(`[instagram-public-replies] ${discarded} item(ns) descartado(s)`);
    }
  } else if (raw !== undefined && raw !== null) {
    console.warn("[instagram-public-replies] public_replies não é array; ignorando:", typeof raw);
  }
  if (out.length > 0) return out;
  if (typeof legacy === "string" && legacy.trim() !== "") return [legacy];
  return [];
}

export function pickPublicReply(replies: string[], random: () => number): string | null {
  if (replies.length === 0) return null;
  const idx = Math.min(replies.length - 1, Math.floor(random() * replies.length));
  return replies[idx];
}
