import { describe, it, expect } from 'vitest';
import { readPageDoc, readPageDocResult, writePageContent, isLegacyContent } from '../pageContent';

/**
 * Gera markdown com uma mistura realista de blocos (heading, parágrafo,
 * lista, fence de código) até passar de `targetLen` caracteres. Uma página
 * real de ~39k caracteres produz ~800 nós no doc convertido; `'palavra
 * '.repeat(n)` sozinho produz só 1-2 nós não importa o tamanho, porque tudo
 * vira um único parágrafo gigante -- não exercita nada que dependa da
 * quantidade de nós (paginação, performance de render, etc.).
 */
function buildRealisticMarkdown(targetLen: number): string {
  const blocks: string[] = [];
  let i = 0;
  let total = 0;
  while (total < targetLen) {
    const n = i % 5;
    const block =
      n === 0
        ? `## Seção ${i}`
        : n === 1
          ? 'Parágrafo comum com texto suficiente para simular conteúdo real de uma página do portal do cliente, repetido algumas vezes para dar volume ao teste.'
          : n === 2
            ? '- item um\n- item dois\n- item três'
            : n === 3
              ? '```\nconst exemplo = true;\n```'
              : 'Outro parágrafo com mais texto para variar o conteúdo gerado, garantindo uma mistura realista de blocos na página.';
    blocks.push(block);
    total += block.length + 2;
    i++;
  }
  return blocks.join('\n\n');
}

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

  it('converte um bloco heading legado preservando o nível', () => {
    const doc = readPageDoc([{ type: 'heading', level: 2, content: 'Prazos' }]);
    const [h] = doc.content as any[];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(2);
    expect(h.content[0].text).toBe('Prazos');
  });

  it('converte um bloco link legado preservando o href', () => {
    const doc = readPageDoc([
      { type: 'link', content: 'Ver o contrato', href: 'https://cdn.example.com/contrato.pdf' },
    ]);
    const [p] = doc.content as any[];
    const linkMark = p.content[0].marks.find((m: any) => m.type === 'link');
    expect(linkMark?.attrs.href).toBe('https://cdn.example.com/contrato.pdf');
    expect(p.content[0].text).toBe('Ver o contrato');
  });

  it('converte um bloco image legado preservando a URL (como link, não como <img>)', () => {
    // O schema do editor de Páginas não tem nó de imagem -- `![](url)`
    // seria descartado pelo parser do TipTap (verificado), perdendo a URL
    // por completo. Um link mantém a URL recuperável.
    const doc = readPageDoc([{ type: 'image', content: 'https://cdn.example.com/foto.jpg' }]);
    const [p] = doc.content as any[];
    const linkMark = p.content[0].marks.find((m: any) => m.type === 'link');
    expect(linkMark?.attrs.href).toBe('https://cdn.example.com/foto.jpg');
  });

  it('devolve doc vazio para conteúdo ausente ou malformado', () => {
    for (const bad of [null, undefined, [], 'x', [{}], [{ type: 'richtext' }]]) {
      expect(readPageDoc(bad).type).toBe('doc');
    }
  });

  it('aguenta uma página realista de ~47k caracteres com uma mistura de blocos', () => {
    const big = buildRealisticMarkdown(47000);
    expect(big.length).toBeGreaterThan(45000);
    const doc = readPageDoc([{ type: 'markdown', content: big }]);
    const nodeCount = (doc.content as any[]).length;
    // Ordem de grandeza esperada para ~47k reais (~800 nós medidos), não um
    // número exato -- só provando que o doc tem uma estrutura de verdade e
    // não caiu no fallback de parágrafo único.
    expect(nodeCount).toBeGreaterThan(200);
    expect(nodeCount).toBeLessThan(2000);
  });

  it('não lança em markdown malformado', () => {
    expect(() => readPageDoc([{ type: 'markdown', content: '### [link sem fim](' }])).not.toThrow();
  });
});

describe('readPageDocResult', () => {
  it('marca converted:true para um bloco richtext já pronto', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(readPageDocResult([{ type: 'richtext', doc }])).toEqual({ doc, converted: true });
  });

  it('marca converted:true para conteúdo genuinamente vazio', () => {
    const result = readPageDocResult([]);
    expect(result.converted).toBe(true);
    expect(result.doc).toEqual({ type: 'doc', content: [] });
  });

  it('marca converted:true para uma conversão de markdown bem-sucedida', () => {
    const result = readPageDocResult([{ type: 'markdown', content: 'Texto simples' }]);
    expect(result.converted).toBe(true);
  });

  // O caminho `converted: false` (generateJSON lançando de verdade) é
  // coberto em `pageContent.fallback.test.ts`, que mocka `@tiptap/html`
  // para forçar a falha -- não dá pra provocá-la de fora do módulo com um
  // markdown válido.

  it('o doc vazio de uma chamada não é afetado por mutar o de outra', () => {
    const first = readPageDocResult([]).doc as { content: unknown[] };
    first.content.push({ type: 'paragraph' });

    const second = readPageDocResult([]).doc as { content: unknown[] };
    expect(second.content).toEqual([]);
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
