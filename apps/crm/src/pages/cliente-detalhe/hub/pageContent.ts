import { generateJSON as generateJSONBrowser } from '@tiptap/html';
import { generateJSON as generateJSONServer } from '@tiptap/html/server';
import { marked } from 'marked';
import { pageEditorExtensions } from './pageEditorSchema';

/**
 * `@tiptap/html`'s `exports` map has `"require": "./dist/index.cjs"` with
 * NO `node` condition -- a plain `require('@tiptap/html')` under CommonJS
 * always resolves to the browser build, which throws "generateJSON can
 * only be used in a browser environment" outside a real DOM. The `import`
 * condition (`node` vs `browser`) does resolve correctly under ESM in
 * Vite, vitest, plain `node`, and `tsx` with `apps/crm/tsconfig.json`,
 * `tsconfig.scripts.json`, or a CommonJS tsconfig -- verified empirically
 * in this session; the browser build only gets picked by forcing
 * `--conditions browser`. Rather than depend on some future caller's
 * module system resolving the bare `@tiptap/html` specifier correctly, we
 * sidestep the conditional-exports resolution entirely: import both
 * builds from their explicit subpaths and pick one at runtime by DOM
 * presence. That works the same whether this module ends up bundled into
 * the browser (Vite, the Task 9 editor) or run headless (a Node
 * migration script, Task 12).
 */
const generateJSON: typeof generateJSONBrowser =
  typeof window === 'undefined' ? generateJSONServer : generateJSONBrowser;

function emptyDoc(): Record<string, unknown> {
  // Novo objeto a cada chamada -- nunca reaproveitar um `content: []`
  // compartilhado entre retornos (mutar um poluiria todos os outros).
  return { type: 'doc', content: [] };
}

export function isLegacyContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((b) => typeof b === 'object' && b !== null && (b as any).type !== 'richtext');
}

export interface ReadPageDocResult {
  doc: Record<string, unknown>;
  /**
   * `false` quando a conversão do markdown legado falhou e `doc` é o
   * fallback (um parágrafo com o texto cru). `true` para um bloco
   * `richtext` já pronto, para conteúdo genuinamente vazio, e para uma
   * conversão de markdown bem-sucedida.
   */
  converted: boolean;
}

/**
 * Mapeia um bloco legado (`heading`/`image`/`link`/`markdown`/`paragraph`,
 * ver `apps/hub/src/types.ts` `HubLegacyBlock`) para o trecho de markdown
 * equivalente, espelhando `supabase/functions/mcp/content.ts` -- com UMA
 * diferença deliberada: `image` vira um link para a URL (`[url](url)`), não
 * a sintaxe de imagem `![](url)`. O schema do editor de Páginas
 * (`pageEditorSchema.ts`) não registra nenhum nó de imagem, e verificei
 * que `![](url)` sem esse nó não sobra como texto -- o parser do TipTap
 * descarta a tag `<img>` inteira, perdendo a URL. Um link preserva a URL.
 */
function legacyBlockToMarkdown(b: Record<string, unknown>): string {
  const type = typeof b.type === 'string' ? b.type : '';
  const text = typeof b.content === 'string' ? b.content : '';
  const href = typeof b.href === 'string' ? b.href : '';

  switch (type) {
    case 'heading': {
      if (!text) return '';
      const level = Math.min(3, Math.max(1, Math.trunc(Number(b.level)) || 1));
      return `${'#'.repeat(level)} ${text}`;
    }
    case 'link':
      if (!text) return '';
      return href ? `[${text}](${href})` : text;
    case 'image':
      return text ? `[${text}](${text})` : '';
    case 'markdown':
    case 'paragraph':
    default:
      return text;
  }
}

export function readPageDocResult(content: unknown): ReadPageDocResult {
  if (!Array.isArray(content) || content.length === 0) return { doc: emptyDoc(), converted: true };

  const rich = content.find(
    (b: any) => b?.type === 'richtext' && typeof b?.doc === 'object' && b.doc !== null,
  ) as { doc: Record<string, unknown> } | undefined;
  if (rich) return { doc: rich.doc, converted: true };

  const markdown = content
    .map((b) =>
      typeof b === 'object' && b !== null
        ? legacyBlockToMarkdown(b as Record<string, unknown>)
        : '',
    )
    .filter(Boolean)
    .join('\n\n');
  if (!markdown) return { doc: emptyDoc(), converted: true };

  try {
    const doc = generateJSON(markdownToHtml(markdown), pageEditorExtensions()) as Record<
      string,
      unknown
    >;
    return { doc, converted: true };
  } catch {
    // Conteúdo malformado (ou um `generateJSON` que falhou por qualquer
    // motivo) nunca pode derrubar o editor: cai para um parágrafo com o
    // texto cru, que o usuário conserta à mão. `converted: false` deixa
    // quem migra dados em lote (Task 12) detectar isso em vez de gravar o
    // fallback como se fosse uma conversão real.
    return {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }],
      },
      converted: false,
    };
  }
}

/** Wrapper de conveniência para o editor: só o doc, nunca lança. */
export function readPageDoc(content: unknown): Record<string, unknown> {
  return readPageDocResult(content).doc;
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
