import type { MentionEntityType, MentionRef } from './types';

/**
 * Plain-text @-mention token syntax (at-mentions spec, Global Constraints):
 * `@[Label](tipo:id)` for membro/cliente/tarefa, `@[Label](post:id:workflowId)` for
 * posts (third segment = the post's parent workflow id; may be absent -- see
 * mentionHref.ts, which renders the chip unlinked in that case). This regex is fixed
 * by the spec -- do not change its shape without updating the spec.
 *
 * Note: `[^\]]+` means a label containing `]` cannot be represented by this syntax.
 * A token with such a label simply fails to match and falls through as plain text
 * (see parseMentionTokens's "label containing ]" test) -- not a crash, a known
 * limitation of the fixed token grammar.
 */
export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\((membro|post|cliente|tarefa):(\d+)(?::(\d+))?\)/g;

export type MentionTokenSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; ref: MentionRef };

function isMentionEntityType(value: unknown): value is MentionEntityType {
  return value === 'membro' || value === 'post' || value === 'cliente' || value === 'tarefa';
}

/** Coerces to a positive integer id or `null`. The `id`/parentId capture groups in
 * MENTION_TOKEN_RE are digits-only so this only matters in practice for
 * extractMentionsFromDoc, whose input is arbitrary TipTap JSON -- a mention node's
 * attrs can carry a non-numeric, missing, or null id (corrupted doc, hand-edited
 * fixture, a paste that lost the id, MentionNode's `id` attr defaulting to `null`
 * when parseHTML fails to find `data-id`). Both extractors feed ids straight to the
 * sync_mentions RPC, so an invalid id must be skipped rather than propagated.
 *
 * Deliberately does NOT use a bare `Number(raw)` coercion: `Number(null)` is `0`
 * (finite!), and so are `Number('')`, `Number(false)`, `Number([])` -- every one of
 * those would silently produce a fabricated `{ id: 0 }` mention instead of being
 * skipped. Only an actual `number` or a non-empty numeric string is accepted, and
 * the result must be a positive integer (entity ids are Postgres bigserial columns,
 * which start at 1 and are never fractional or negative).
 */
function toFiniteId(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return null;
  }
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Splits `text` into alternating plain-text and mention segments by scanning for
 * MENTION_TOKEN_RE matches. Text outside any match (including all of `text` when
 * there are no matches) passes through untouched as `{ kind: 'text' }` segments.
 */
export function parseMentionTokens(text: string): MentionTokenSegment[] {
  const segments: MentionTokenSegment[] = [];
  // Local instance: MENTION_TOKEN_RE is a shared module-level `g` regex, and reusing
  // it directly here would leak `lastIndex` state into any other concurrent read of
  // the exported constant.
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }

    const [full, label, entityType, idRaw, parentIdRaw] = match;
    const id = toFiniteId(idRaw);
    if (id !== null && isMentionEntityType(entityType)) {
      segments.push({
        kind: 'mention',
        ref: {
          entityType,
          id,
          label,
          parentId: parentIdRaw !== undefined ? toFiniteId(parentIdRaw) : null,
        },
      });
    } else {
      // Regex guarantees these shapes in practice; kept for total-function safety.
      segments.push({ kind: 'text', value: full });
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Formats a MentionRef back into its plain-text token. Only `post` mentions ever
 * carry a third (workflow id) segment -- even if a non-post ref happens to have
 * `parentId` set, it is ignored here, since MENTION_TOKEN_RE's third group is
 * post-specific by convention (mentionHref.ts / MentionChip only read parentId for
 * `post`, so a stray value on another entity type is never meaningful).
 */
export function formatMentionToken(ref: MentionRef): string {
  if (ref.entityType === 'post' && ref.parentId != null) {
    return `@[${ref.label}](post:${ref.id}:${ref.parentId})`;
  }
  return `@[${ref.label}](${ref.entityType}:${ref.id})`;
}

/**
 * Replaces every mention token in `text` with '@' + its label, e.g.
 * `@[João](membro:7)` -> `@João`. For previews (conversation list rows,
 * notification bodies) that render as plain text and must never leak the raw
 * `@[Label](tipo:id)` syntax to a reader who isn't looking at a rendered chip.
 */
export function stripMentionTokens(text: string): string {
  // Local instance, same reasoning as parseMentionTokens: MENTION_TOKEN_RE is
  // a shared module-level `g` regex, and reusing it directly here would leak
  // `lastIndex` state into any other concurrent read of the exported constant.
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  return text.replace(re, (_full, label: string) => `@${label}`);
}

/** Dedupes by `entityType:id`, keeping the first occurrence. */
function dedupeMentions(refs: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const ref of refs) {
    const key = `${ref.entityType}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Extracts every mention token from plain text (comment content, tarefa descricao),
 * deduped by `entityType:id`. */
export function extractMentionsFromText(text: string): MentionRef[] {
  const refs: MentionRef[] = [];
  for (const segment of parseMentionTokens(text)) {
    if (segment.kind === 'mention') refs.push(segment.ref);
  }
  return dedupeMentions(refs);
}

/** Loosely-typed TipTap JSON node shape -- callers pass `editor.getJSON()` output;
 * this module deliberately has no @tiptap/core dependency. */
interface JsonNodeLike {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
}

function mentionRefFromAttrs(attrs: Record<string, unknown> | undefined): MentionRef | null {
  if (!attrs || !isMentionEntityType(attrs.entityType)) return null;
  const id = toFiniteId(attrs.id);
  if (id === null) return null;
  const label = typeof attrs.label === 'string' ? attrs.label : '';
  const parentId = attrs.parentId == null ? null : toFiniteId(attrs.parentId);
  return { entityType: attrs.entityType, id, label, parentId };
}

function walkDoc(node: unknown, out: MentionRef[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkDoc(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const n = node as JsonNodeLike;
  if (n.type === 'mention') {
    const ref = mentionRefFromAttrs(n.attrs);
    if (ref) out.push(ref);
  }
  if (n.content !== undefined) walkDoc(n.content, out);
}

/** Recursively walks a TipTap document (JSON, as from `editor.getJSON()`) collecting
 * every `mention` node's attrs, deduped by `entityType:id`. Non-finite/missing ids
 * are skipped (see toFiniteId's doc comment) rather than aborting the whole walk. */
export function extractMentionsFromDoc(docJson: unknown): MentionRef[] {
  const refs: MentionRef[] = [];
  walkDoc(docJson, refs);
  return dedupeMentions(refs);
}
