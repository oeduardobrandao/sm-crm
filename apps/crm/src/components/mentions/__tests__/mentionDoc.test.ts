import { describe, expect, it } from 'vitest';
import { mentionDocToText, textToMentionDoc } from '../mentionDoc';

describe('mentionDoc', () => {
  it.each([
    '',
    'texto simples',
    '@[Eduardo Souza](membro:12) pode revisar?',
    'oi @[Ana](membro:1) e @[Carrossel - [AUTOMAÇÃO] v2](post:9:4)',
    'linha 1\n\nlinha 3 com @[Cliente X](cliente:7)\n',
    '  espaços  nas bordas  ',
    '@[sem fim](membro:abc) fica texto',
  ])('round-trips %j', (text) => {
    expect(mentionDocToText(textToMentionDoc(text))).toBe(text);
  });

  it('turns a token into a mention node', () => {
    const doc = textToMentionDoc('oi @[Ana](membro:1)!');
    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'oi ' },
      {
        type: 'mention',
        attrs: { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      },
      { type: 'text', text: '!' },
    ]);
  });

  it('reads hard breaks as newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] },
      ],
    };
    expect(mentionDocToText(doc)).toBe('a\n');
  });

  it('keeps a mention with no valid id as its visible text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { entityType: 'membro', id: null, label: 'Ana' } }],
        },
      ],
    };
    expect(mentionDocToText(doc)).toBe('@Ana');
  });
});
