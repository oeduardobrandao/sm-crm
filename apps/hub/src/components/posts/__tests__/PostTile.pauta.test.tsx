import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HubContext } from '../../../HubContext';
import { PostTile } from '../PostTile';
import { StoriesRail } from '../StoriesRail';
import type { HubPost, HubPostMedia } from '../../../types';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn/a.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...over,
  };
}

function post(): HubPost {
  return {
    id: 7,
    titulo: 'Coleção de inverno',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Legenda',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [media({ id: 1 }), media({ id: 2 })],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
  };
}

function renderTile(pauta: boolean, selected = true) {
  return render(
    <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: pauta } } as never}>
      <PostTile
        post={post()}
        mode="select"
        selected={selected}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />
    </HubContext.Provider>,
  );
}

describe('PostTile Pauta', () => {
  it('selection ring and check circle follow the brand primary', () => {
    const { container } = renderTile(true);
    const tile = screen.getByRole('checkbox');
    expect(tile).toHaveClass('ring-[var(--hub-primary)]');
    expect(tile).not.toHaveClass('ring-[#0095f6]');
    const check = container.querySelector('span.rounded-full.w-7') as HTMLElement;
    expect(check.className).not.toContain('bg-[#0095f6]');
    expect(check.style.background).toBe('var(--hub-primary)');
    expect(check.style.color).toBe('var(--hub-primary-fg)');
  });

  it('format glyph uses the preset chip radius', () => {
    const { container } = renderTile(true, false);
    const glyph = container.querySelector('span.bg-black\\/45') as HTMLElement;
    expect(glyph).toHaveClass('rounded-[var(--hub-r-chip)]');
    expect(glyph).not.toHaveClass('rounded-md');
  });

  it('status tag stays clear of the format glyph and truncates', () => {
    const { container } = renderTile(true, false);
    const tag = container.querySelector('[data-hub-status]') as HTMLElement;
    expect(tag.parentElement!.className).toContain('right-10');
    expect(tag.querySelector('.truncate')).not.toBeNull();
  });

  it('classic status tag wrapper is unchanged', () => {
    const { container } = renderTile(false, false);
    const label = screen.getAllByText(/aguardando/i)[0];
    expect(label.parentElement!.className).toBe('absolute top-2 left-2 z-10');
    expect(container.querySelector('[data-hub-status]')).toBeNull();
  });

  it('classic keeps the Instagram blue and rounded-md', () => {
    const { container } = renderTile(false);
    expect(screen.getByRole('checkbox')).toHaveClass('ring-[#0095f6]');
    expect((container.querySelector('span.rounded-full.w-7') as HTMLElement).className).toContain(
      'bg-[#0095f6]',
    );
    expect(container.querySelector('span.bg-black\\/45')).toHaveClass('rounded-md');
  });
});

describe('StoriesRail Pauta', () => {
  function renderRail(pauta: boolean) {
    const { container } = render(
      <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: pauta } } as never}>
        <StoriesRail posts={[{ ...post(), tipo: 'stories' }]} onOpen={vi.fn()} />
      </HubContext.Provider>,
    );
    return container.querySelector('span[aria-hidden="true"].w-3\\.5') as HTMLElement;
  }

  it('status dot reads the status token in Pauta', () => {
    expect(renderRail(true).style.background).toBe('var(--hub-st-wait-fg)');
  });

  it('status dot keeps the classic hex otherwise', () => {
    expect(renderRail(false).style.background).toBe('rgb(245, 163, 66)');
  });
});
