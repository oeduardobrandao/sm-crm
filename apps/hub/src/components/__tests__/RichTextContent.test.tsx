import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichTextContent } from '../RichTextContent';

const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Primeiro parágrafo' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Segundo' }] },
  ],
};

describe('RichTextContent (lazy TipTap front)', () => {
  it('reads as plain text while TipTap loads, then mounts the rich editor', async () => {
    const { container } = render(
      <RichTextContent content={doc} className="corpo" fallbackText="texto guardado" />,
    );

    // Before the chunk resolves: the stored plain text, like TipTap's own fallback.
    const placeholder = container.querySelector('.corpo p.whitespace-pre-wrap');
    expect(placeholder?.textContent).toBe('texto guardado');
    expect(container.querySelector('.ProseMirror')).toBeNull();

    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    expect(screen.getByText('Primeiro parágrafo')).toBeInTheDocument();
    expect(container.querySelector('p.whitespace-pre-wrap')).toBeNull();
  });
});
