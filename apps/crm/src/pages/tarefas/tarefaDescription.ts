import { parseMentionTokens } from '@/components/mentions/mentionTokens';

export type TarefaDescriptionDoc = Record<string, unknown>;

function lineContent(line: string): Array<Record<string, unknown>> | undefined {
  const content = parseMentionTokens(line).map((segment) =>
    segment.kind === 'mention'
      ? {
          type: 'mention',
          attrs: {
            entityType: segment.ref.entityType,
            id: segment.ref.id,
            label: segment.ref.label,
            parentId: segment.ref.parentId ?? null,
          },
        }
      : { type: 'text', text: segment.value },
  );
  return content.length > 0 ? content : undefined;
}

/** Converts legacy plain task descriptions into a TipTap document without losing mentions. */
export function plainTextToTarefaDescriptionDoc(text: string): TarefaDescriptionDoc {
  return {
    type: 'doc',
    content: text.split(/\r?\n/).map((line) => {
      const content = lineContent(line);
      return { type: 'paragraph', ...(content ? { content } : {}) };
    }),
  };
}

/** Image URLs are short-lived signed values; only stable R2 metadata belongs in the database. */
export function sanitizeTarefaDescriptionDoc(doc: TarefaDescriptionDoc): TarefaDescriptionDoc {
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk).filter((item) => item !== undefined);
    if (!value || typeof value !== 'object') return value;

    const node = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    if (node.type === 'inlineImage' && next.attrs && typeof next.attrs === 'object') {
      const r2Key = (next.attrs as Record<string, unknown>).r2Key;
      if (typeof r2Key !== 'string' || r2Key.trim().length === 0) return undefined;
      const {
        src: _src,
        blurSrc: _blurSrc,
        loading: _loading,
        ...stableAttrs
      } = next.attrs as Record<string, unknown>;
      next.attrs = stableAttrs;
    }
    return next;
  }

  return walk(doc) as TarefaDescriptionDoc;
}

export function isTarefaDescriptionEmpty(doc: TarefaDescriptionDoc | null): boolean {
  if (!doc) return true;

  function hasMeaningfulContent(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasMeaningfulContent);
    if (!value || typeof value !== 'object') return false;
    const node = value as Record<string, unknown>;
    if (node.type === 'inlineImage') {
      const r2Key = (node.attrs as Record<string, unknown> | undefined)?.r2Key;
      return typeof r2Key === 'string' && r2Key.trim().length > 0;
    }
    if (node.type === 'mention') return true;
    if (node.type === 'text') return typeof node.text === 'string' && node.text.trim().length > 0;
    return hasMeaningfulContent(node.content);
  }

  return !hasMeaningfulContent(doc.content);
}
