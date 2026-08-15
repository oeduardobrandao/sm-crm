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
