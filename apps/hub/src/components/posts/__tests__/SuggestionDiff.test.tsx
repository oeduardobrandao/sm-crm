import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuggestionDiff, suggestionDiffBlocks } from '../SuggestionDiff';
import { suggestionAwareCaption } from '../../../lib/postView';
import type { HubPost, PendingEditSuggestion } from '../../../types';

const MEDIA = {
  id: 1,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/a.jpg',
  thumbnail_url: null,
  width: 1,
  height: 1,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
} as HubPost['media'][number];

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo original',
    scheduled_at: null,
    ig_caption: 'Legenda original',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

function sugg(over: Partial<PendingEditSuggestion> = {}): PendingEditSuggestion {
  return {
    id: 9,
    suggested_conteudo: null,
    suggested_conteudo_plain: 'Corpo original',
    suggested_ig_caption: 'Legenda original',
    changed_fields: [],
    updated_at: '2026-09-28T10:00:00.000Z',
    ...over,
  };
}

describe('suggestionDiffBlocks', () => {
  it('returns only the caption block for a caption-only change on a media post', () => {
    const blocks = suggestionDiffBlocks(post(), sugg({ suggested_ig_caption: 'Legenda nova' }));
    expect(blocks).toEqual([
      { field: 'caption', before: 'Legenda original', after: 'Legenda nova' },
    ]);
  });

  it('returns a text block when the body text differs', () => {
    const blocks = suggestionDiffBlocks(
      post({ media: [] }),
      sugg({ suggested_conteudo_plain: 'Corpo novo' }),
    );
    expect(blocks).toEqual([{ field: 'text', before: 'Corpo original', after: 'Corpo novo' }]);
  });

  it('ignores null suggested values', () => {
    const blocks = suggestionDiffBlocks(
      post(),
      sugg({ suggested_conteudo_plain: null as unknown as string, suggested_ig_caption: null }),
    );
    expect(blocks).toEqual([]);
  });

  it('diffs a media caption against the LEGENDA fallback the client actually edited', () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro\nLEGENDA: legenda derivada' });
    const blocks = suggestionDiffBlocks(
      p,
      sugg({
        suggested_conteudo_plain: p.conteudo_plain,
        suggested_ig_caption: 'legenda derivada nova',
      }),
    );
    expect(blocks).toEqual([
      { field: 'caption', before: 'legenda derivada', after: 'legenda derivada nova' },
    ]);
  });

  it('does not invent a caption change for a text post without a caption', () => {
    const p = post({ media: [], ig_caption: null });
    expect(suggestionDiffBlocks(p, sugg({ suggested_ig_caption: '' }))).toEqual([]);
  });
});

describe('SuggestionDiff', () => {
  it('renders removed and added words', () => {
    const { container } = render(
      <SuggestionDiff
        post={post()}
        suggestion={sugg({ suggested_ig_caption: 'Legenda editada' })}
      />,
    );
    // The equal segment "Legenda " is also a text node, so scope the label lookup to the <p>.
    expect(screen.getByText('Legenda', { selector: 'p' })).toBeInTheDocument();
    expect(container.querySelector('del')?.textContent).toContain('original');
    expect(container.querySelector('ins')?.textContent).toContain('editada');
  });

  it('says so when there is no text difference', () => {
    render(<SuggestionDiff post={post()} suggestion={sugg()} />);
    expect(screen.getByText('Sem diferenças de texto em relação ao original.')).toBeInTheDocument();
  });
});

describe('suggestionAwareCaption', () => {
  it("keeps a suggestion's empty caption instead of falling back to body text", () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro LEGENDA: derivada' });
    expect(suggestionAwareCaption(p, sugg({ suggested_ig_caption: '' }))).toBe('');
  });
  it('falls back to deriveCaption without a suggestion', () => {
    const p = post({ ig_caption: null, conteudo_plain: 'Roteiro LEGENDA: derivada' });
    expect(suggestionAwareCaption(p, null)).toBe('derivada');
  });
});
