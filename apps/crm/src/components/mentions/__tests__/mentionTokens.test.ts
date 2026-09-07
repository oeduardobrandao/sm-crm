import { describe, expect, it } from 'vitest';
import {
  extractMentionsFromDoc,
  extractMentionsFromText,
  formatMentionToken,
  parseMentionTokens,
} from '../mentionTokens';
import type { MentionRef } from '../types';

describe('formatMentionToken / parseMentionTokens round-trip', () => {
  it('round-trips a membro mention with no third segment', () => {
    const ref: MentionRef = { entityType: 'membro', id: 7, label: 'Ana' };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Ana](membro:7)');
    expect(parseMentionTokens(token)).toEqual([
      { kind: 'mention', ref: { ...ref, parentId: null } },
    ]);
  });

  it('round-trips a cliente mention', () => {
    const ref: MentionRef = { entityType: 'cliente', id: 12, label: 'Clínica X' };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Clínica X](cliente:12)');
    expect(parseMentionTokens(token)).toEqual([
      { kind: 'mention', ref: { ...ref, parentId: null } },
    ]);
  });

  it('round-trips a tarefa mention', () => {
    const ref: MentionRef = { entityType: 'tarefa', id: 3, label: 'Revisar copy' };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Revisar copy](tarefa:3)');
    expect(parseMentionTokens(token)).toEqual([
      { kind: 'mention', ref: { ...ref, parentId: null } },
    ]);
  });

  it('round-trips a post mention WITH a workflow segment', () => {
    const ref: MentionRef = {
      entityType: 'post',
      id: 2,
      label: 'Post de lançamento',
      parentId: 42,
    };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Post de lançamento](post:2:42)');
    expect(parseMentionTokens(token)).toEqual([{ kind: 'mention', ref }]);
  });

  it('round-trips a post mention WITHOUT a workflow segment (parentId absent)', () => {
    const ref: MentionRef = { entityType: 'post', id: 2, label: 'Post sem workflow' };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Post sem workflow](post:2)');
    expect(parseMentionTokens(token)).toEqual([
      { kind: 'mention', ref: { ...ref, parentId: null } },
    ]);
  });

  it('ignores a non-post ref parentId when formatting (never emits a third segment)', () => {
    const ref: MentionRef = { entityType: 'membro', id: 5, label: 'Bruno', parentId: 99 };
    expect(formatMentionToken(ref)).toBe('@[Bruno](membro:5)');
  });

  it('round-trips a label containing "]" (bracketed post title)', () => {
    const ref: MentionRef = {
      entityType: 'post',
      id: 3519,
      label: 'Carrossel - [AUTOMAÇÃO] Zumbido no ouvido',
      parentId: 968,
    };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Carrossel - [AUTOMAÇÃO] Zumbido no ouvido](post:3519:968)');
    expect(parseMentionTokens(token)).toEqual([{ kind: 'mention', ref }]);
  });

  it('collapses line terminators in the label so the token stays parseable', () => {
    const ref: MentionRef = { entityType: 'tarefa', id: 8, label: 'Linha um\nlinha dois' };
    const token = formatMentionToken(ref);
    expect(token).toBe('@[Linha um linha dois](tarefa:8)');
    expect(parseMentionTokens(token)).toEqual([
      { kind: 'mention', ref: { ...ref, label: 'Linha um linha dois', parentId: null } },
    ]);
  });
});

describe('parseMentionTokens', () => {
  it('passes plain text without any tokens through untouched', () => {
    const text = 'Nenhuma menção aqui, só texto normal.';
    expect(parseMentionTokens(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('splits text around a mention, preserving surrounding text segments', () => {
    const result = parseMentionTokens('Oi @[Ana](membro:1), tudo bem?');
    expect(result).toEqual([
      { kind: 'text', value: 'Oi ' },
      { kind: 'mention', ref: { entityType: 'membro', id: 1, label: 'Ana', parentId: null } },
      { kind: 'text', value: ', tudo bem?' },
    ]);
  });

  it('parses adjacent tokens with no text between them', () => {
    const result = parseMentionTokens('@[Ana](membro:1)@[Bruno](membro:2)');
    expect(result).toEqual([
      { kind: 'mention', ref: { entityType: 'membro', id: 1, label: 'Ana', parentId: null } },
      { kind: 'mention', ref: { entityType: 'membro', id: 2, label: 'Bruno', parentId: null } },
    ]);
  });

  it('parses a label containing "]" instead of falling through as plain text', () => {
    const result = parseMentionTokens('Oi @[Foo]Bar](membro:3) tchau');
    expect(result).toEqual([
      { kind: 'text', value: 'Oi ' },
      { kind: 'mention', ref: { entityType: 'membro', id: 3, label: 'Foo]Bar', parentId: null } },
      { kind: 'text', value: ' tchau' },
    ]);
  });

  it('parses a post title with bracketed segments (the reported unclickable-mention bug)', () => {
    const label =
      'Carrossel - [AUTOMAÇÃO] Zumbido no ouvido não é "estresse". Às vezes é isso aqui.';
    const result = parseMentionTokens(`@[${label}](post:3519:968)`);
    expect(result).toEqual([
      { kind: 'mention', ref: { entityType: 'post', id: 3519, label, parentId: 968 } },
    ]);
  });

  it('keeps two bracketed-label mentions on one line separate (lazy label match)', () => {
    const result = parseMentionTokens('@[A [x]](membro:1) e @[B [y]](membro:2)');
    expect(result).toEqual([
      { kind: 'mention', ref: { entityType: 'membro', id: 1, label: 'A [x]', parentId: null } },
      { kind: 'text', value: ' e ' },
      { kind: 'mention', ref: { entityType: 'membro', id: 2, label: 'B [y]', parentId: null } },
    ]);
  });

  it('does not swallow a literal tail-less "@[...]" fragment into a later mention label', () => {
    const result = parseMentionTokens('veja @[interno] e @[Ana](membro:1)');
    expect(result).toEqual([
      { kind: 'text', value: 'veja @[interno] e ' },
      { kind: 'mention', ref: { entityType: 'membro', id: 1, label: 'Ana', parentId: null } },
    ]);
  });

  it('does not match an unknown entity type', () => {
    const text = '@[Ana](desconhecido:1)';
    expect(parseMentionTokens(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('handles an empty string', () => {
    expect(parseMentionTokens('')).toEqual([]);
  });

  it('treats an id of "0" as invalid (falls through to plain text, not { id: 0 })', () => {
    const text = '@[Zero](membro:0)';
    expect(parseMentionTokens(text)).toEqual([{ kind: 'text', value: text }]);
  });
});

describe('extractMentionsFromText', () => {
  it('dedupes repeated mentions of the same entity, keeping the first occurrence', () => {
    const refs = extractMentionsFromText(
      '@[Ana](membro:1) falou com @[Bruno](membro:2) e depois com @[Ana](membro:1) de novo.',
    );
    expect(refs).toEqual([
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      { entityType: 'membro', id: 2, label: 'Bruno', parentId: null },
    ]);
  });

  it('does not dedupe the same id across different entity types', () => {
    const refs = extractMentionsFromText('@[Ana](membro:1) @[Tarefa](tarefa:1)');
    expect(refs).toEqual([
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      { entityType: 'tarefa', id: 1, label: 'Tarefa', parentId: null },
    ]);
  });

  it('returns an empty array for text with no mentions', () => {
    expect(extractMentionsFromText('sem menções aqui')).toEqual([]);
  });
});

describe('extractMentionsFromDoc', () => {
  it('walks a nested TipTap doc collecting mention node attrs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Oi ' },
            {
              type: 'mention',
              attrs: { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
            },
            { type: 'text', text: ' veja o ' },
            {
              type: 'mention',
              attrs: { entityType: 'post', id: 9, label: 'Post X', parentId: 42 },
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'mention',
                      attrs: { entityType: 'cliente', id: 3, label: 'Clínica X', parentId: null },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(extractMentionsFromDoc(doc)).toEqual([
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      { entityType: 'post', id: 9, label: 'Post X', parentId: 42 },
      { entityType: 'cliente', id: 3, label: 'Clínica X', parentId: null },
    ]);
  });

  it('dedupes repeated mention nodes by entityType:id', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { entityType: 'membro', id: 1, label: 'Ana' } },
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { entityType: 'membro', id: 1, label: 'Ana' } }],
        },
      ],
    };
    expect(extractMentionsFromDoc(doc)).toEqual([
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
    ]);
  });

  it('skips mention nodes with a non-finite/missing id instead of throwing', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { entityType: 'membro', id: 'not-a-number', label: 'Bad' } },
        { type: 'mention', attrs: { entityType: 'membro', label: 'MissingId' } },
        { type: 'mention', attrs: { entityType: 'membro', id: 5, label: 'Good' } },
      ],
    };
    expect(extractMentionsFromDoc(doc)).toEqual([
      { entityType: 'membro', id: 5, label: 'Good', parentId: null },
    ]);
  });

  it('skips an explicit null id (MentionNode attrs default `id` to null when parseHTML finds no data-id) rather than coercing it to 0', () => {
    // Number(null) is 0 -- a finite, truthy-looking number -- so a naive
    // `Number.isFinite(Number(raw))` guard would let this through as `{ id: 0 }`
    // instead of skipping it. A pasted/corrupted doc losing a mention's id must not
    // fabricate a fake id that later gets fed to the sync_mentions RPC.
    const doc = {
      type: 'doc',
      content: [{ type: 'mention', attrs: { entityType: 'membro', id: null, label: 'NullId' } }],
    };
    expect(extractMentionsFromDoc(doc)).toEqual([]);
  });

  it('skips other falsy-but-Number()-coercible-to-0 ids: "", false, 0, [], and NaN', () => {
    const badIds: unknown[] = ['', false, 0, [], NaN];
    for (const id of badIds) {
      const doc = {
        type: 'doc',
        content: [{ type: 'mention', attrs: { entityType: 'membro', id, label: 'Bad' } }],
      };
      expect(extractMentionsFromDoc(doc)).toEqual([]);
    }
  });

  it('skips nodes with an unrecognized entityType', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'mention', attrs: { entityType: 'unknown', id: 1, label: 'X' } }],
    };
    expect(extractMentionsFromDoc(doc)).toEqual([]);
  });

  it('returns an empty array for a doc with no mention nodes', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oi' }] }],
    };
    expect(extractMentionsFromDoc(doc)).toEqual([]);
  });

  it('handles null/undefined input gracefully', () => {
    expect(extractMentionsFromDoc(null)).toEqual([]);
    expect(extractMentionsFromDoc(undefined)).toEqual([]);
  });
});
