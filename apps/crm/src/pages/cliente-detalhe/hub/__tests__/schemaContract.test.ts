import { describe, it, expect } from 'vitest';
import { pageEditorExtensions } from '../pageEditorSchema';
import { richTextExtensions } from '../../../../../../hub/src/components/RichTextContent';

/**
 * Se o editor do CRM puder persistir um nó ou marca que o Hub não conhece, o
 * TipTap descarta o DOCUMENTO INTEIRO ao ler — o cliente abre a página do
 * portal e vê branco, sem erro em lugar nenhum. Este teste é a única coisa
 * entre esse bug e produção.
 */
describe('contrato de schema entre o editor de Páginas e o leitor do Hub', () => {
  it('todo nó/marca que o editor persiste é conhecido pelo Hub', () => {
    const names = (exts: { name: string }[]) => new Set(exts.map((e) => e.name));
    const editor = names(pageEditorExtensions() as { name: string }[]);
    const hub = names(richTextExtensions() as { name: string }[]);

    // `placeholder` (@tiptap/extension-placeholder) só registra um plugin
    // ProseMirror de decoração (addProseMirrorPlugins) -- não define node
    // nem mark e não tem addAttributes/addGlobalAttributes. Não existe forma
    // de `editor.getJSON()` conter um nó/marca "placeholder": o texto de
    // placeholder é uma Decoration calculada ao vivo pela view, nunca parte
    // do documento persistido. Por isso sua ausência no Hub não é o bug de
    // página em branco que este teste existe para pegar -- confirmado lendo
    // node_modules/@tiptap/extensions/src/placeholder/placeholder.ts.
    const NEVER_PERSISTED = new Set(['placeholder']);

    const missing = [...editor].filter((n) => !hub.has(n) && !NEVER_PERSISTED.has(n));
    expect(missing, `Hub não conhece: ${missing.join(', ')}`).toEqual([]);
  });

  it('não inclui as extensões deliberadamente fora', () => {
    const names = new Set((pageEditorExtensions() as { name: string }[]).map((e) => e.name));
    for (const banned of ['mention', 'commentHighlight', 'inlineImage', 'youtube', 'iframe']) {
      expect(names.has(banned), `${banned} não pode estar no editor de Páginas`).toBe(false);
    }
  });
});
