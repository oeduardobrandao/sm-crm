import { formatMentionToken, parseMentionTokens } from './mentionTokens';
import type { MentionEntityType } from './types';

/**
 * Converts between the plain-text token format comments are stored in
 * (`@[Label](tipo:id)`, see mentionTokens.ts) and the minimal TipTap document
 * MentionEditor edits: one paragraph per line, text and `mention` nodes inline.
 * `mentionDocToText(textToMentionDoc(s)) === s` for every string.
 */

interface JsonNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

export function textToMentionDoc(text: string): JsonNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const content: JsonNode[] = [];
      for (const seg of parseMentionTokens(line)) {
        if (seg.kind === 'mention') {
          content.push({
            type: 'mention',
            attrs: {
              entityType: seg.ref.entityType,
              id: seg.ref.id,
              label: seg.ref.label,
              parentId: seg.ref.parentId ?? null,
            },
          });
        } else if (seg.value) {
          // ProseMirror rejects empty text nodes.
          content.push({ type: 'text', text: seg.value });
        }
      }
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
    }),
  };
}

function isEntityType(v: unknown): v is MentionEntityType {
  return v === 'membro' || v === 'post' || v === 'cliente' || v === 'tarefa';
}

function inlineToText(nodes: JsonNode[] | undefined): string {
  let out = '';
  for (const node of nodes ?? []) {
    if (node.type === 'text') out += node.text ?? '';
    else if (node.type === 'hardBreak') out += '\n';
    else if (node.type === 'mention') {
      const a = node.attrs ?? {};
      const label = typeof a.label === 'string' ? a.label : '';
      const id = typeof a.id === 'number' ? a.id : Number(a.id);
      // A mention without a valid entity can't round-trip as a token; keep its visible text.
      if (!isEntityType(a.entityType) || !Number.isInteger(id) || id <= 0) {
        out += `@${label}`;
        continue;
      }
      const parentId = typeof a.parentId === 'number' ? a.parentId : null;
      out += formatMentionToken({ entityType: a.entityType, id, label, parentId });
    }
  }
  return out;
}

export function mentionDocToText(doc: JsonNode): string {
  return (doc.content ?? []).map((block) => inlineToText(block.content)).join('\n');
}
