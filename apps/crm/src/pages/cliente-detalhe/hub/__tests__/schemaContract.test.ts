import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { pageEditorExtensions } from '../pageEditorSchema';
import { richTextExtensions } from '../../../../../../hub/src/components/RichTextContent';

/**
 * Se o editor do CRM puder persistir um nó ou marca que o Hub não conhece, o
 * TipTap descarta o DOCUMENTO INTEIRO ao ler — o cliente abre a página do
 * portal e vê branco, sem erro em lugar nenhum. Este teste é a única coisa
 * entre esse bug e produção.
 *
 * Compara os SCHEMAS resolvidos (`getSchema`), não os nomes das extensões:
 * `starterKit` é um único nome de extensão que expande para ~12 nós e
 * marcas (heading, codeBlock, bulletList, bold, ...), então comparar nomes
 * de extensão não pega o Hub configurando `StarterKit.configure({
 * codeBlock: false })` -- os nomes continuam batendo enquanto o schema do
 * Hub perde o nó de verdade. `getSchema` expande cada extensão nos nós e
 * marcas que ela realmente registra, então essa divergência aparece como
 * `node:codeBlock` faltando.
 */
describe('contrato de schema entre o editor de Páginas e o leitor do Hub', () => {
  it('todo nó/marca que o editor persiste é conhecido pelo Hub', () => {
    const editorSchema = getSchema(pageEditorExtensions());
    const hubSchema = getSchema(richTextExtensions());

    const missing = [
      ...Object.keys(editorSchema.nodes)
        .filter((n) => !(n in hubSchema.nodes))
        .map((n) => `node:${n}`),
      ...Object.keys(editorSchema.marks)
        .filter((m) => !(m in hubSchema.marks))
        .map((m) => `mark:${m}`),
    ];

    // Sem lista de exclusão: `Placeholder` (a única extensão do editor que o
    // Hub não registra) não define node nem mark -- só um plugin
    // ProseMirror de decoração -- então nunca aparece em
    // `editorSchema.nodes`/`marks` e nunca precisaria ser filtrado aqui.
    expect(missing, `Hub não conhece: ${missing.join(', ')}`).toEqual([]);
  });

  it('não inclui as extensões deliberadamente fora', () => {
    const names = new Set((pageEditorExtensions() as { name: string }[]).map((e) => e.name));
    for (const banned of ['mention', 'commentHighlight', 'inlineImage', 'youtube', 'iframe']) {
      expect(names.has(banned), `${banned} não pode estar no editor de Páginas`).toBe(false);
    }
  });
});
