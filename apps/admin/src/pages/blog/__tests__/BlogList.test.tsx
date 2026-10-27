import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { BlogList } from '../BlogList';
import { formatDay, type BlogListItem, type FilePostRow } from '../blog-view';

const file: FilePostRow = {
  kind: 'arquivo',
  slug: 'post-a-mao',
  title: 'Post escrito à mão',
  description: 'Descrição',
  category: 'guia',
  date: '2026-10-25',
};
const items: BlogListItem[] = [{ kind: 'arquivo', row: file }];

function renderList(over: Partial<React.ComponentProps<typeof BlogList>> = {}) {
  return render(
    <MemoryRouter>
      <BlogList
        items={items}
        tab="publicados"
        selectedKey={null}
        now={new Date('2026-10-27T12:00:00Z')}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        {...over}
      />
    </MemoryRouter>,
  );
}

describe('BlogList with a hand-written post', () => {
  it('shows title, badge and the post date, linking to the arquivo detail', () => {
    renderList();
    const link = screen.getByRole('link', { name: 'Post escrito à mão' });
    expect(link).toHaveAttribute('href', '/admin/blog/arquivo/post-a-mao?tab=publicados');
    expect(screen.getByText('Escrito à mão')).toBeInTheDocument();
    expect(screen.getByText(formatDay('2026-10-25'))).toBeInTheDocument();
  });

  it('offers the live-site icon and marks the selected row', () => {
    const { container } = renderList({ selectedKey: 'arquivo:post-a-mao' });
    expect(screen.getByRole('link', { name: 'Abrir Post escrito à mão no site' })).toHaveAttribute(
      'href',
      'https://www.mesaas.com.br/blog/post-a-mao?ref=admin',
    );
    expect(container.querySelector('li[aria-current="true"]')).not.toBeNull();
  });
});
