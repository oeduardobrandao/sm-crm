import { describe, it, expect, vi } from 'vitest';

// Mockado num arquivo próprio (em vez de dentro de pageContent.test.ts) para
// não afetar os outros testes, que precisam do `generateJSON` de verdade.
// `readPageDoc`/`readPageDocResult` sempre usam o build de browser sob
// jsdom (vitest.config.ts define `environment: 'jsdom'`, então `window`
// existe), daí só precisamos mockar `@tiptap/html` -- a versão de
// `@tiptap/html/server` nem chega a ser chamada neste ambiente.
vi.mock('@tiptap/html', () => ({
  generateJSON: () => {
    throw new Error('falha simulada de generateJSON');
  },
}));

import { readPageDoc, readPageDocResult } from '../pageContent';

describe('readPageDoc / readPageDocResult -- fallback quando a conversão falha', () => {
  it('devolve converted:false e o parágrafo com o texto cru', () => {
    const markdown = '## Prazos\n\nAté **2** dias.';
    const result = readPageDocResult([{ type: 'markdown', content: markdown }]);

    expect(result.converted).toBe(false);
    expect(result.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }],
    });
  });

  it('readPageDoc nunca lança mesmo com o conversor quebrado', () => {
    expect(() => readPageDoc([{ type: 'markdown', content: 'x' }])).not.toThrow();
    expect(readPageDoc([{ type: 'markdown', content: 'x' }]).type).toBe('doc');
  });
});
