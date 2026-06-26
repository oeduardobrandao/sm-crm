import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarPostDetailPanel } from '../CalendarPostDetailPanel';
import type { ClientePost } from '@/store';

// Full mock (NOT partial) so the real @/store → supabase client is never loaded
// in jsdom. ClientePost is a type-only import below, so it's erased at runtime
// and doesn't need to be provided by the mock.
vi.mock('@/store', () => ({ getPostPreview: vi.fn() }));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

import { getPostPreview } from '@/store';
import { listPostMedia } from '@/services/postMedia';

const mockPreview = vi.mocked(getPostPreview);
const mockMedia = vi.mocked(listPostMedia);

beforeAll(() => {
  // Radix Popover (used by DateTimePicker) needs these in jsdom
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const post: ClientePost = {
  id: 1,
  workflow_id: 10,
  titulo: 'Bastidores do consultório',
  tipo: 'reels',
  status: 'aprovado_cliente',
  scheduled_at: '2026-07-26T23:00:00.000Z',
  ordem: 0,
  workflow_titulo: 'Posts Julho - Marina',
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof CalendarPostDetailPanel>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalendarPostDetailPanel
        post={post}
        membros={[{ id: 9, nome: 'Débora Kristin' } as never]}
        isCurrentWorkflow
        isLocked={false}
        onClose={vi.fn()}
        onReschedule={vi.fn()}
        onRemoveDate={vi.fn()}
        onOpenPost={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('CalendarPostDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockResolvedValue({
      conteudo_plain: 'Olá! Hoje vamos falar sobre a rotina.',
      responsavel_id: 9,
      ig_caption: null,
      published_at: null,
      instagram_permalink: null,
    });
    mockMedia.mockResolvedValue([]);
  });

  it('renders the title and metadata instantly from the post prop', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Bastidores do consultório' })).toBeTruthy();
    expect(screen.getByText('Posts Julho - Marina')).toBeTruthy();
  });

  it('shows reschedule + actions for current-workflow unlocked posts', async () => {
    renderPanel();
    expect(screen.getByText('Reagendar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abrir post completo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remover data/ })).toBeTruthy();
    expect(await screen.findByText('Débora Kristin')).toBeTruthy();
  });

  it('is read-only with a workflow note for other-workflow posts', () => {
    renderPanel({ isCurrentWorkflow: false });
    expect(screen.getByText(/Pertence ao workflow/)).toBeTruthy();
    expect(screen.queryByText('Reagendar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Abrir post completo/ })).toBeNull();
  });

  it('hides reschedule/remove and shows the lock reason for locked posts', () => {
    renderPanel({ isLocked: true, lockReason: 'Post já agendado no Instagram' });
    expect(screen.queryByText('Reagendar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
    expect(screen.getByText(/Post já agendado no Instagram/)).toBeTruthy();
  });
});
