import { act, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ArticleEditor } from '../editor/ArticleEditor';

// BubbleMenuView leaves a 250ms debounce timer behind; drain it before jsdom is torn down.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 300)));

const DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'abrir',
          marks: [{ type: 'link', attrs: { href: 'https://mesaas.com.br' } }],
        },
        { type: 'text', text: ' sublinhado', marks: [{ type: 'underline' }] },
      ],
    },
  ],
};

describe('ArticleEditor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers Link and Underline once (StarterKit), with no duplicate-extension warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ArticleEditor initialContent={DOC} onUpdate={() => {}} />);
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const dup = warn.mock.calls.filter((c) => String(c[0]).includes('Duplicate extension names'));
    expect(dup).toEqual([]);
  });

  it('keeps the link attributes and the underline mark', async () => {
    render(<ArticleEditor initialContent={DOC} onUpdate={() => {}} />);
    const link = await screen.findByRole('link', { name: 'abrir' });
    expect(link).toHaveAttribute('href', 'https://mesaas.com.br');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(document.querySelector('.ProseMirror u')).toHaveTextContent('sublinhado');
  });
});
