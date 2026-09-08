import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { postEditorExtensions } from '../PostEditor';

/**
 * Finding 4 (task-11, fix round 3): PostEditor's Link extension had no `isAllowedUri`
 * at all, so the shared link policy (@mesaas/link-policy) -- enforced on the read side
 * by the Hub's RichTextContent.tsx -- was not enforced on the write side for post
 * captions. An `ftp:`/credentialed/relative URL typed here persisted and rendered dead
 * (`href=""`) in the Hub.
 *
 * These tests build a real headless `Editor` from the exact extension array PostEditor
 * mounts (`postEditorExtensions`) and actually insert text through it -- exercising the
 * live autolink plugin, not the policy function in isolation. That distinction matters:
 * fix round 2 wired `isAllowedRichTextLinkUrl` (the strict, href-only policy) straight
 * into an editor with `autolink: true` and it type-checked and unit-tested fine while
 * silently breaking every autolink case in the running editor, because TipTap's autolink
 * plugin validates the RAW TYPED TEXT, not the href it is about to assign.
 */
function buildEditor() {
  return new Editor({
    extensions: postEditorExtensions({ mentionSearch: async () => [] }),
  });
}

describe('política de link do PostEditor (Finding 4, fix round 3)', () => {
  it('digitar um e-mail seguido de espaço vira link mailto: de verdade', () => {
    const editor = buildEditor();
    editor.commands.insertContent('contato@exemplo.com ');
    expect(editor.getHTML()).toContain('href="mailto:contato@exemplo.com"');
    editor.destroy();
  });

  it('digitar um domínio nu seguido de espaço vira link http de verdade', () => {
    const editor = buildEditor();
    editor.commands.insertContent('www.exemplo.com ');
    expect(editor.getHTML()).toContain('href="http://www.exemplo.com"');
    editor.destroy();
  });

  it('digitar uma URL https completa continua virando link', () => {
    const editor = buildEditor();
    editor.commands.insertContent('https://exemplo.com ');
    expect(editor.getHTML()).toContain('href="https://exemplo.com"');
    editor.destroy();
  });

  it('digitar uma URL ftp seguida de espaço NÃO vira link (antes desta correção, virava)', () => {
    const editor = buildEditor();
    editor.commands.insertContent('ftp://exemplo.com/segredo ');
    expect(editor.getHTML()).not.toContain('<a ');
    editor.destroy();
  });

  it('setLink com href relativo é recusado (comando vira no-op)', () => {
    const editor = buildEditor();
    editor.commands.insertContent('abc');
    editor.commands.selectAll();
    const applied = editor.commands.setLink({ href: '/pagina-interna' });
    expect(applied).toBe(false);
    expect(editor.getHTML()).not.toContain('<a ');
    editor.destroy();
  });

  it('setLink com href credenciado é recusado (comando vira no-op)', () => {
    const editor = buildEditor();
    editor.commands.insertContent('abc');
    editor.commands.selectAll();
    const applied = editor.commands.setLink({ href: 'https://user:senha@exemplo.com' });
    expect(applied).toBe(false);
    expect(editor.getHTML()).not.toContain('<a ');
    editor.destroy();
  });

  it('setLink com https:// explícito continua funcionando', () => {
    const editor = buildEditor();
    editor.commands.insertContent('abc');
    editor.commands.selectAll();
    const applied = editor.commands.setLink({ href: 'https://exemplo.com' });
    expect(applied).toBe(true);
    expect(editor.getHTML()).toContain('href="https://exemplo.com"');
    editor.destroy();
  });
});
