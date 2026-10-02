import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../RichTextTiptap', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { RichTextContent } from '../RichTextContent';

describe('RichTextContent when the TipTap chunk fails to load', () => {
  it('keeps showing the plain text instead of throwing to the route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, findByText } = render(
      <RichTextContent
        content={{ type: 'doc', content: [] }}
        className="corpo"
        fallbackText="texto guardado"
      />,
    );
    expect(await findByText('texto guardado')).toBeInTheDocument();
    // Still there once the rejected import has settled.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.corpo p.whitespace-pre-wrap')?.textContent).toBe(
      'texto guardado',
    );
  });

  it("uses the document's own text when there is no stored text", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Primeiro parágrafo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Segundo' }] },
      ],
    };
    const { container } = render(<RichTextContent content={doc} className="corpo" />);
    expect(container.querySelector('.corpo p.whitespace-pre-wrap')?.textContent).toBe(
      'Primeiro parágrafo\n\nSegundo',
    );
  });
});
