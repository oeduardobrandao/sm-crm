// Matching puro (sem I/O) da automação de comentário -> DM. PT-BR: comparação
// sem acentos e sem caixa; keyword casa como palavra/frase INTEIRA (limites =
// qualquer coisa que não seja letra/dígito unicode), então "promo" não casa
// "compromisso" nem "promoção".

export function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesKeywords(commentText: string, keywords: string[]): boolean {
  const text = normalizeForMatch(commentText).replace(/\s+/g, " ").trim();
  return keywords.some((k) => {
    const kw = normalizeForMatch(k).replace(/\s+/g, " ").trim();
    if (!kw) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw)}($|[^\\p{L}\\p{N}])`, "u");
    return re.test(text);
  });
}

export interface AutomationCandidate {
  id: string;
  conta_id: string;
  client_id: number;
  ig_media_id: string | null;
  created_at: string;
}

export interface AutomationTarget {
  ig_media_id: string | null;
  workflow_post_id: number | null;
}

/**
 * Específico/ligado (ig_media_id set) casa só a própria mídia; global exige
 * AMBOS nulos; pendente (só workflow_post_id) nunca casa -- o vínculo com a
 * mídia acontece na publicação (trigger z3 / sweep do cron).
 */
export function targetMatches(a: AutomationTarget, mediaId: string | null): boolean {
  if (a.ig_media_id !== null) return a.ig_media_id === mediaId;
  return a.workflow_post_id === null;
}

/** Específico > global, depois created_at ASC, id ASC (spec: "a mais antiga vence"). */
export function pickWinner<T extends AutomationCandidate>(matched: T[]): T | null {
  if (matched.length === 0) return null;
  const sorted = [...matched].sort((a, b) =>
    ((a.ig_media_id ? 0 : 1) - (b.ig_media_id ? 0 : 1)) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
  return sorted[0];
}
