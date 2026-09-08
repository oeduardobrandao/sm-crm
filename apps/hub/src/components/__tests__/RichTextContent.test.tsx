import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { render, screen, waitFor } from '@testing-library/react';
import { richTextExtensions, RichTextContent } from '../RichTextContent';

// The hub reads post `conteudo` (TipTap JSON) by feeding it into an editor built from
// `richTextExtensions`. If that schema is missing a mark/node type present in the JSON,
// TipTap drops the WHOLE document (it logs a warning instead of throwing, so the
// conteudo_plain fallback never kicks in) and the body renders blank in the portal.
//
// We assert at the schema level via getSchema + Node.fromJSON: this exercises the exact
// extension set the component uses, reproduces the real failure (RangeError: "There is no
// mark type ... in this schema"), and avoids the jsdom-only plugin collision that building
// a full editor view triggers.

describe('hub rich-text schema (richTextExtensions)', () => {
  it('parses body text that carries a CRM commentHighlight mark', () => {
    // Exactly what the CRM editor persists into `conteudo` when an agent leaves a comment
    // on post text (setCommentHighlight -> setMark).
    const commentedRichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'CENA 1 do roteiro',
              marks: [{ type: 'commentHighlight', attrs: { threadId: 7, resolved: false } }],
            },
          ],
        },
      ],
    };

    const schema = getSchema(richTextExtensions(false));
    const doc = PMNode.fromJSON(schema, commentedRichDoc);

    expect(doc.textContent).toContain('CENA 1 do roteiro');
  });

  it('parses a doc containing a mention node for every entity type', () => {
    // Exactly what the CRM editor persists into `conteudo` when an @-mention chip is
    // inserted (Task 4's suggestion dropdown). If the hub schema doesn't register the
    // `mention` node, Node.fromJSON throws ("There is no node type ... in this schema")
    // and the whole document fails to load, not just the mention.
    const mentionAttrs = [
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      { entityType: 'post', id: 2, label: 'Post de lançamento', parentId: 42 },
      { entityType: 'cliente', id: 3, label: 'Clínica X', parentId: null },
      { entityType: 'tarefa', id: 4, label: 'Revisar copy', parentId: null },
    ];
    const mentionDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: mentionAttrs.map((attrs) => ({ type: 'mention', attrs })),
        },
      ],
    };

    const schema = getSchema(richTextExtensions(false));
    const doc = PMNode.fromJSON(schema, mentionDoc);

    const found: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'mention') found.push(node.attrs);
    });

    // Attrs must round-trip exactly through the JSON persistence path (this IS how
    // `conteudo` is stored -- ProseMirror JSON, not HTML), proving parseHTML/renderHTML
    // aren't the only fidelity path and the JSON schema itself preserves every attr.
    expect(found).toEqual(mentionAttrs);
  });
});

describe('RichTextContent read-only mount', () => {
  // This is the regression test for the bug fixed in 813ac18e: `editorProps: editable ?
  // {...} : undefined` overrode Tiptap's own `{}` default during option merging, and
  // `Editor.createView()` crashed on every read-only mount. `EditorErrorBoundary` swallowed
  // the crash, so the component silently rendered `fallbackText` instead of the real
  // document -- invisible in production because every caller always passes
  // `fallbackText={post.conteudo_plain}`, so it just looked like plain text. A schema-level
  // test (like the ones above) can never catch this: the crash only happens once TipTap
  // actually builds an editor view, which schema-only assertions never do. Rendering a
  // read-only instance WITH a fallbackText and asserting the rich doc wins is exactly the
  // assertion that would have caught the 3.5-month-old regression.
  it('renders the rich document, not the fallback, when mounted read-only', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conteúdo rico do post' }] }],
    };

    render(
      <RichTextContent content={doc} editable={false} fallbackText="Texto simples de fallback" />,
    );

    expect(await screen.findByText('Conteúdo rico do post')).toBeInTheDocument();
    expect(screen.queryByText('Texto simples de fallback')).not.toBeInTheDocument();
  });
});

function docWithLink(href: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'clique aqui', marks: [{ type: 'link', attrs: { href } }] },
        ],
      },
    ],
  };
}

describe('RichTextContent link URL policy (Finding 4, fix round 1)', () => {
  // TipTap's default Link `isAllowedUri` already blocks `javascript:` (kept here as a
  // baseline), but its allowlist still includes `ftp:`/`ftps:` and never inspects
  // userinfo -- so `ftp://` links and `https://user:pass@host` links rendered straight
  // through by default. The Hub's legacy block renderer (PaginaPage's `link`/`markdown`
  // blocks) already rejects both via `sanitizeExternalUrl`; richtext links must follow
  // the SAME policy, or the portal enforces two different rules depending on which
  // block shape a page happens to be stored in.
  it.each([
    ['javascript:alert(1)'],
    ['ftp://example.com/segredo'],
    ['https://user:senha@example.com'],
  ])('não deixa o href %s sobreviver na âncora renderizada', async (href) => {
    const { container } = render(<RichTextContent content={docWithLink(href)} editable={false} />);

    await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
    const anchor = container.querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).not.toBe(href);
    expect(anchor.getAttribute('href') ?? '').not.toMatch(/^(javascript|ftp):/i);
    expect(anchor.getAttribute('href') ?? '').not.toContain('user:senha@');
  });

  it('mantém um link https comum intacto', async () => {
    const href = 'https://exemplo.com.br/pagina';
    const { container } = render(<RichTextContent content={docWithLink(href)} editable={false} />);

    await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
    const anchor = container.querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(href);
  });
});

describe('RichTextContent link URL policy (Finding 1, fix round 2)', () => {
  // Fix round 1 (above) closed the javascript:/ftp:/credentials hole by reusing
  // `sanitizeExternalUrl` -- but that helper is http/https-only, so it ALSO killed
  // `mailto:`, `tel:`, and in-portal relative/anchor links (measured `href=""` on all
  // of them post-fix). `isAllowedRichTextLinkUrl` (@mesaas/link-policy) is the
  // corrected, single shared policy: http/https/mailto/tel allowed, everything else
  // (including relative/anchor-only URLs) rejected -- and it's the SAME function the
  // CRM page editor applies on write (pageEditorSchema.ts), so a link that persists
  // can't come out dead here.
  it.each([['mailto:contato@exemplo.com'], ['tel:+5511999999999']])(
    'mantém o link %s intacto e clicável',
    async (href) => {
      const { container } = render(
        <RichTextContent content={docWithLink(href)} editable={false} />,
      );

      await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
      const anchor = container.querySelector('a') as HTMLAnchorElement;
      expect(anchor.getAttribute('href')).toBe(href);
    },
  );

  it.each([
    ['data:text/html,<script>alert(1)</script>'],
    ['/pagina-interna'],
    ['#ancora'],
    ['//evil.com'],
  ])('não deixa o href %s sobreviver na âncora renderizada', async (href) => {
    const { container } = render(<RichTextContent content={docWithLink(href)} editable={false} />);

    await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
    const anchor = container.querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).not.toBe(href);
    expect(anchor.getAttribute('href')).toBe('');
  });
});
