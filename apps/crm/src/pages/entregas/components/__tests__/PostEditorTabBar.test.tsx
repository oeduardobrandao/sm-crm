import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostEditorTabBar } from '../PostEditorTabBar';

describe('PostEditorTabBar', () => {
  it('renders the five tabs with the active one selected', () => {
    render(<PostEditorTabBar active="conteudo" onChange={vi.fn()} showProperties={true} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Conteúdo',
      'Mídia',
      'Propriedades',
      'Publicação',
      'Comentários',
    ]);
    expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Mídia' })).toHaveAttribute('aria-selected', 'false');
  });

  it('hides the Propriedades tab when showProperties is false', () => {
    render(<PostEditorTabBar active="conteudo" onChange={vi.fn()} showProperties={false} />);
    expect(screen.queryByRole('tab', { name: 'Propriedades' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('shows count badges only when greater than zero', () => {
    render(
      <PostEditorTabBar
        active="conteudo"
        onChange={vi.fn()}
        showProperties={true}
        mediaCount={7}
        commentCount={0}
      />,
    );
    expect(screen.getByRole('tab', { name: /Mídia/ })).toHaveTextContent('7');
    expect(screen.getByRole('tab', { name: 'Comentários' })).not.toHaveTextContent('0');
  });

  it('shows attention dots for content and publish', () => {
    const { container } = render(
      <PostEditorTabBar
        active="conteudo"
        onChange={vi.fn()}
        showProperties={true}
        contentAttention
        publishAttention
      />,
    );
    expect(container.querySelector('.drawer-post-tab-dot--warning')).not.toBeNull();
    expect(container.querySelector('.drawer-post-tab-dot--danger')).not.toBeNull();
  });

  it('calls onChange with the clicked tab key', () => {
    const onChange = vi.fn();
    render(<PostEditorTabBar active="conteudo" onChange={onChange} showProperties={true} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Publicação' }));
    expect(onChange).toHaveBeenCalledWith('publicacao');
  });
});
