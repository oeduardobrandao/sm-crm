import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ScheduledPost, IgAccountStatus } from '../../../../store';

// Canonical-only registry (what the real hook returns while definitions load),
// without dragging TanStack Query / the supabase client into this test.
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

// Mirrors ScheduleButton.test.tsx's mocks: PublicacoesPanel renders ScheduleButton
// internally, so the platform-service spies live at that boundary.
vi.mock('../../../../services/instagram', () => ({
  scheduleInstagramPost: vi.fn(),
  cancelInstagramSchedule: vi.fn(),
  retryInstagramPublish: vi.fn(),
  publishInstagramPostNow: vi.fn(),
}));

vi.mock('../../../../services/tiktok', () => ({
  scheduleTikTokPost: vi.fn(),
  cancelTikTokSchedule: vi.fn(),
  publishTikTokPostNow: vi.fn(),
  retryTikTokPublish: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { PublicacoesPanel } from '../PublicacoesPanel';
import { scheduleInstagramPost, cancelInstagramSchedule } from '../../../../services/instagram';
import { scheduleTikTokPost, cancelTikTokSchedule } from '../../../../services/tiktok';

function makeScheduledPost(overrides?: Partial<ScheduledPost>): ScheduledPost {
  return {
    id: 1,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Posts Julho',
    titulo: 'Post de teste',
    tipo: 'feed',
    status: 'aprovado_cliente',
    scheduled_at: '2026-08-01T14:00:00.000Z',
    published_at: null,
    ig_caption: 'Legenda de teste #hashtag',
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ...overrides,
  };
}

const healthyIgStatus: IgAccountStatus = { revoked: false, expired: false, canPublish: true };

const baseProps = {
  igStatuses: new Map<number, IgAccountStatus>([[1, healthyIgStatus]]),
  openableWorkflowIds: new Set<number>(),
  isLoading: false,
  selectedLabel: '1 de agosto, 2026',
  onPostClick: vi.fn(),
  onStatusChange: vi.fn(),
};

describe('PublicacoesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes cancel through the TikTok service (not Instagram) for a "both"-platform post', async () => {
    vi.mocked(cancelTikTokSchedule).mockResolvedValueOnce({ ok: true });
    const post = makeScheduledPost({
      status: 'agendado',
      platform: 'both',
      tiktok_publish_status: null,
    });

    render(<PublicacoesPanel posts={[post]} {...baseProps} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Cancelar'));
    });

    expect(cancelTikTokSchedule).toHaveBeenCalledWith(1);
    expect(cancelInstagramSchedule).not.toHaveBeenCalled();
  });

  it('disables the schedule button for a tiktok-targeted aprovado_cliente post (no settings UI in the compact panel)', () => {
    const post = makeScheduledPost({
      status: 'aprovado_cliente',
      platform: 'tiktok',
      ig_caption: null,
    });

    render(<PublicacoesPanel posts={[post]} {...baseProps} />);

    const scheduleBtn = screen.getByText('Agendar').closest('button')!;
    expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
    expect(scheduleBtn.getAttribute('title')).toBe('Abra o post para configurar o TikTok');
  });

  it('leaves an Instagram-only post unchanged: schedule routes to scheduleInstagramPost', async () => {
    vi.mocked(scheduleInstagramPost).mockResolvedValueOnce({ ok: true, status: 'agendado' });
    const post = makeScheduledPost({ status: 'aprovado_cliente', platform: 'instagram' });

    render(<PublicacoesPanel posts={[post]} {...baseProps} />);

    const scheduleBtn = screen.getByText('Agendar').closest('button')!;
    expect(scheduleBtn.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(scheduleBtn);
    });

    expect(scheduleInstagramPost).toHaveBeenCalledWith(1);
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });

  // Object-based click contract (Task 13): the row hands the caller the whole
  // post, not a (workflowId, postId) pair -- also pins the "Abrir no fluxo"
  // label for an openable wired post (the true branch of the ternary at
  // ~line 154; the avulso/false branch is pinned by the next test).
  it('invokes onPostClick with the post object (not ids) for an openable wired post, and shows "Abrir no fluxo"', () => {
    const onPostClick = vi.fn();
    const post = makeScheduledPost({ id: 10, workflow_id: 10 });

    render(
      <PublicacoesPanel
        posts={[post]}
        {...baseProps}
        openableWorkflowIds={new Set([10])}
        onPostClick={onPostClick}
      />,
    );

    expect(screen.getByText('Abrir no fluxo')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post de teste'));
    expect(onPostClick).toHaveBeenCalledWith(post);
  });

  // A post avulso (workflow_id null) is always openable, even when its id is
  // (necessarily) absent from openableWorkflowIds -- and its affordance reads
  // "Abrir" (no fluxo to open into) rather than "Abrir no fluxo".
  it('a post avulso (workflow_id null) is always openable regardless of openableWorkflowIds, and shows "Abrir"', () => {
    const onPostClick = vi.fn();
    const post = makeScheduledPost({ id: 7, workflow_id: null });

    render(
      <PublicacoesPanel
        posts={[post]}
        {...baseProps}
        openableWorkflowIds={new Set()}
        onPostClick={onPostClick}
      />,
    );

    expect(screen.getByText('Abrir')).toBeInTheDocument();
    expect(screen.queryByText('Abrir no fluxo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Post de teste'));
    expect(onPostClick).toHaveBeenCalledWith(post);
  });

  // Pre-existing gating (predates Task 13, unchanged by it): a wired post whose
  // workflow is not (yet) in openableWorkflowIds stays inert -- no affordance,
  // no click.
  it('a wired post whose workflow is not openable stays non-clickable, with no "Abrir" affordance', () => {
    const onPostClick = vi.fn();
    const post = makeScheduledPost({ id: 11, workflow_id: 99 });

    render(
      <PublicacoesPanel
        posts={[post]}
        {...baseProps}
        openableWorkflowIds={new Set()}
        onPostClick={onPostClick}
      />,
    );

    expect(screen.queryByText('Abrir no fluxo')).not.toBeInTheDocument();
    expect(screen.queryByText('Abrir')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Post de teste'));
    expect(onPostClick).not.toHaveBeenCalled();
  });
});
