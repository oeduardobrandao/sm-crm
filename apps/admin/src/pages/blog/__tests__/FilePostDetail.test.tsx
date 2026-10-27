import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FilePostDetail } from '../FilePostDetail';
import type { FilePostRow } from '../blog-view';

const post: FilePostRow = {
  kind: 'arquivo',
  slug: 'post-a-mao',
  title: 'Post escrito à mão',
  description: 'Uma descrição do post.',
  category: 'guia',
  date: '2026-10-25',
};

describe('FilePostDetail', () => {
  it('shows the post metadata and the live-link buttons', () => {
    render(<FilePostDetail post={post} />);
    expect(screen.getByRole('heading', { name: 'Post escrito à mão' })).toBeInTheDocument();
    expect(screen.getByText('Uma descrição do post.')).toBeInTheDocument();
    expect(screen.getByText('Escrito à mão')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir no site/ })).toHaveAttribute(
      'href',
      'https://www.mesaas.com.br/blog/post-a-mao?ref=admin',
    );
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument();
  });

  it('explains the post lives in the repository and offers no write actions', () => {
    render(<FilePostDetail post={post} />);
    expect(
      screen.getByText(
        'Este post vive no código (apps/crm/src/content/blog). Edite pelo repositório.',
      ),
    ).toBeInTheDocument();
    for (const name of [/Editar texto/, /Despublicar/, /Rejeitar/, /Aprovar/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
