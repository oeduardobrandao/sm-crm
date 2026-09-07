import { describe, it, expect } from 'vitest';
import { readPageDoc, writePageContent, isLegacyContent } from '../pageContent';

describe('readPageDoc', () => {
  it('devolve o doc de um bloco richtext sem tocar nele', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(readPageDoc([{ type: 'richtext', doc }])).toEqual(doc);
  });

  it('converte um bloco markdown', () => {
    const doc = readPageDoc([{ type: 'markdown', content: '## Prazos\n\nAté **2** dias.' }]);
    expect(doc.type).toBe('doc');
    const [h, p] = doc.content as any[];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(2);
    expect(h.content[0].text).toBe('Prazos');
    expect(p.content.some((n: any) => n.marks?.some((m: any) => m.type === 'bold'))).toBe(true);
  });

  it('converte um bloco paragraph legado', () => {
    const doc = readPageDoc([{ type: 'paragraph', content: 'Texto solto' }]);
    expect((doc.content as any[])[0].content[0].text).toBe('Texto solto');
  });

  it('devolve doc vazio para conteúdo ausente ou malformado', () => {
    for (const bad of [null, undefined, [], 'x', [{}], [{ type: 'richtext' }]]) {
      expect(readPageDoc(bad).type).toBe('doc');
    }
  });

  it('aguenta um documento de ~47k caracteres', () => {
    const big = '## T\n\n' + 'palavra '.repeat(6000);
    expect(big.length).toBeGreaterThan(45000);
    const doc = readPageDoc([{ type: 'markdown', content: big }]);
    expect((doc.content as any[]).length).toBeGreaterThan(1);
  });

  it('não lança em markdown malformado', () => {
    expect(() => readPageDoc([{ type: 'markdown', content: '### [link sem fim](' }])).not.toThrow();
  });
});

describe('isLegacyContent', () => {
  it('é falso para richtext e verdadeiro para os tipos antigos', () => {
    expect(isLegacyContent([{ type: 'richtext', doc: {} }])).toBe(false);
    expect(isLegacyContent([{ type: 'markdown', content: 'x' }])).toBe(true);
    expect(isLegacyContent([{ type: 'paragraph', content: 'x' }])).toBe(true);
    expect(isLegacyContent([])).toBe(false);
  });
});

describe('writePageContent', () => {
  it('embrulha o doc num array de um bloco', () => {
    const doc = { type: 'doc', content: [] };
    expect(writePageContent(doc)).toEqual([{ type: 'richtext', doc }]);
  });
});
