import { useCallback, useMemo } from 'react';

const KEY = (id: string) => `hub-page-draft:${id}`;

export interface PageDraft {
  /** `undefined` só acontece ao carregar um rascunho gravado no formato antigo
   *  (fix round 1 do Finding 1), que não tinha título nenhum. */
  title?: string;
  doc: Record<string, unknown>;
}

interface StoredPageDraft {
  version: 1;
  title: string;
  doc: Record<string, unknown>;
}

function isStoredPageDraft(value: unknown): value is StoredPageDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { doc?: unknown }).doc === 'object' &&
    (value as { doc?: unknown }).doc !== null
  );
}

/**
 * Formato gravado ANTES do fix round 1: o rascunho era só o doc do ProseMirror
 * (`{ type: 'doc', content: [...] }`), sem título nenhum -- daí o bug original
 * (Finding 1): um título editado nunca era salvo, e reabrir a página revertia
 * o título pro valor do servidor enquanto o corpo vinha do rascunho, produzindo
 * um par título/corpo incoerente que um "Salvar" gravava sem avisar ninguém.
 *
 * Um rascunho gravado nesse formato antigo ainda tem que carregar -- perder o
 * corpo guardado seria repetir a mesma promessa quebrada, só que de um jeito
 * diferente. `version: 1` é o que diferencia o formato novo do antigo (o doc
 * puro nunca tem uma chave `version`).
 */
function parseStoredDraft(raw: string): PageDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // JSON corrompido
  }
  if (isStoredPageDraft(parsed)) {
    return { title: parsed.title, doc: parsed.doc };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return { doc: parsed as Record<string, unknown> };
  }
  return null;
}

/**
 * `useBlocker` está proibido no projeto (React Router só honra o último blocker
 * registrado, e registrar um desliga a troca silenciosa entre deploys -- ver
 * silent-update.router.test.ts). A estratégia daqui é não bloquear nada: o
 * rascunho sobrevive a navegar para fora E a fechar a aba, que é mais proteção
 * do que um blocker daria.
 *
 * `pageId` só é `null` se o chamador passar `null` explicitamente -- todo método vira
 * no-op nesse caso, sem lançar. `PaginasPage` passa uma chave estável (`new-<clienteId>`)
 * mesmo para a página ainda sem id (fix round 2, Finding 3): passar `null` ali fazia o
 * rascunho da composição de "Nova página" virar no-op silencioso, perdendo tudo que fosse
 * digitado antes de salvar.
 */
export function usePageDraft(pageId: string | null) {
  const draft = useMemo(() => {
    if (!pageId) return null;
    try {
      const raw = localStorage.getItem(KEY(pageId));
      return raw ? parseStoredDraft(raw) : null;
    } catch {
      return null; // aba privativa, cota estourada
    }
  }, [pageId]);

  const saveDraft = useCallback(
    (title: string, doc: Record<string, unknown>) => {
      if (!pageId) return;
      try {
        const payload: StoredPageDraft = { version: 1, title, doc };
        localStorage.setItem(KEY(pageId), JSON.stringify(payload));
      } catch {
        /* rascunho é conveniência, nunca pode derrubar a edição */
      }
    },
    [pageId],
  );

  const clearDraft = useCallback(() => {
    if (!pageId) return;
    try {
      localStorage.removeItem(KEY(pageId));
    } catch {
      /* idem */
    }
  }, [pageId]);

  return { draft, saveDraft, clearDraft };
}
