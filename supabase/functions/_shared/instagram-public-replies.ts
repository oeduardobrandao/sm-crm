// Pool de respostas públicas da automação comentário -> DM. Módulo puro.
// Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
//
// Fail-open POR DESIGN, mesmo racional do parseDmButtons (instagram-dm-payload.ts):
// o enforcement da forma é o CHECK do banco; um throw aqui envenenaria envios.
// Isso cobre o VALOR de public_replies vindo NULL, '[]' ou malformado (item
// não-string, excesso de itens) -- nesses casos o legado public_reply decide.
// A COLUNA em si é pré-requisito DURO, não fail-open: `executeSend`
// (instagram-webhook/process.ts) faz um SELECT explícito de public_replies na
// revalidação, e a ausência da coluna é um 400 do PostgREST, não um valor
// undefined tratável aqui. A migration da Task 1 tem que estar aplicada ANTES
// do redeploy deste código, sem exceção.

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
