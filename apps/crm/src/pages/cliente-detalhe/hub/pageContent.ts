import { generateJSON } from '@tiptap/html';
import { marked } from 'marked';
import { pageEditorExtensions } from './pageEditorSchema';

/**
 * ATENÇÃO -- quem escrever o script de migração da Task 12 (Node, sem DOM,
 * chamando `readPageDoc` diretamente): o import acima de `@tiptap/html`
 * resolve pelo `exports` condicional do pacote (`browser` vs `node`), e essa
 * resolução SE PROVOU não confiável sob `tsx --tsconfig <config> script.ts`
 * -- o mesmo padrão usado por `scripts/seo/prerender.tsx` e
 * `scripts/blog/overlap.ts` neste repo. Com `moduleResolution: "Bundler"`
 * no tsconfig passado (como em `tsconfig.scripts.json`), o resolvedor do tsx
 * escolhe a build de browser mesmo em Node puro (sem `window`); ela lança
 * "generateJSON can only be used in a browser environment", o catch abaixo
 * engole o erro, e `readPageDoc` devolve o parágrafo de fallback com o
 * markdown cru para TODA página convertida -- sem nenhum erro visível.
 * Verificado empiricamente nesta sessão (Task 8); rodando via `node` puro ou
 * via `tsx` sem `--tsconfig` a resolução funciona corretamente. Antes de
 * rodar a migração real, confirme com uma chamada de teste que o resultado é
 * um doc estruturado (heading/bold/etc.), não um único parágrafo com o
 * markdown bruto -- se cair no fallback, force `@tiptap/html/server` no
 * script (ou rode a migração sem essa flag do tsconfig).
 */

const EMPTY_DOC = { type: 'doc', content: [] } as const;

export function isLegacyContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((b) => typeof b === 'object' && b !== null && (b as any).type !== 'richtext');
}

export function readPageDoc(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content) || content.length === 0) return { ...EMPTY_DOC };

  const rich = content.find(
    (b: any) => b?.type === 'richtext' && typeof b?.doc === 'object' && b.doc !== null,
  ) as { doc: Record<string, unknown> } | undefined;
  if (rich) return rich.doc;

  const markdown = content
    .map((b: any) => (typeof b?.content === 'string' ? b.content : ''))
    .filter(Boolean)
    .join('\n\n');
  if (!markdown) return { ...EMPTY_DOC };

  try {
    return generateJSON(markdownToHtml(markdown), pageEditorExtensions()) as Record<
      string,
      unknown
    >;
  } catch {
    // Conteúdo malformado nunca pode derrubar o editor: cai para um parágrafo
    // com o texto cru, que o usuário conserta à mão.
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }],
    };
  }
}

export function writePageContent(
  doc: Record<string, unknown>,
): [{ type: 'richtext'; doc: Record<string, unknown> }] {
  return [{ type: 'richtext' as const, doc }];
}

/** `marked.parse` é síncrono quando não há extensões async registradas. */
function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false, gfm: true }) as string;
}
