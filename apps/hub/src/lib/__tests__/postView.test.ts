import { describe, expect, it } from 'vitest';
import { isClientVisible, pickPostCardKind, VISIBLE_STATUSES } from '../postView';
import type { HubPost } from '../../types';

const base = { id: 1, titulo: 't', ordem: 0, conteudo: null, conteudo_plain: '', scheduled_at: null, ig_caption: null, instagram_permalink: null, media: [] } as unknown as HubPost;

describe('isClientVisible', () => {
  it('accepts client-visible statuses', () => {
    expect(isClientVisible('enviado_cliente')).toBe(true);
    expect(isClientVisible('postado')).toBe(true);
  });
  it('rejects internal statuses', () => {
    expect(isClientVisible('rascunho')).toBe(false);
    expect(isClientVisible('revisao_interna')).toBe(false);
    expect(isClientVisible('aprovado_interno')).toBe(false);
  });
  it('has exactly 6 members', () => {
    expect(VISIBLE_STATUSES.size).toBe(6);
  });
});

describe('pickPostCardKind (media-first)', () => {
  it('media-less stories render as text, not story', () => {
    expect(pickPostCardKind({ ...base, tipo: 'stories', media: [] })).toBe('text');
  });
  it('stories with media render as story', () => {
    expect(pickPostCardKind({ ...base, tipo: 'stories', media: [{}] } as unknown as HubPost)).toBe('story');
  });
  it('feed/carrossel with media render as instagram', () => {
    expect(pickPostCardKind({ ...base, tipo: 'feed', media: [{}] } as unknown as HubPost)).toBe('instagram');
    expect(pickPostCardKind({ ...base, tipo: 'carrossel', media: [{}] } as unknown as HubPost)).toBe('instagram');
  });
  it('media-less feed renders as text', () => {
    expect(pickPostCardKind({ ...base, tipo: 'feed', media: [] })).toBe('text');
  });
});
