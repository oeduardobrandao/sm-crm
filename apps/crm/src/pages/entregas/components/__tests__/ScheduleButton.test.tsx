import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPost } from '../../../../store';

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

import { ScheduleButton } from '../ScheduleButton';
import {
  scheduleInstagramPost,
  cancelInstagramSchedule,
  retryInstagramPublish,
  publishInstagramPostNow,
} from '../../../../services/instagram';
import {
  scheduleTikTokPost,
  cancelTikTokSchedule,
  publishTikTokPostNow,
  retryTikTokPublish,
} from '../../../../services/tiktok';
import { toast } from 'sonner';

// Exact string from supabase/functions/_shared/tiktok-publish-utils.ts's audited-mode gate
// (validateForTikTokScheduling) — the 422 `details` array item ScheduleButton pattern-matches
// to flip TikTokSettingsPanel's showTestModeBanner via onTikTokUnaudited.
const TIKTOK_UNAUDITED_MESSAGE =
  'App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok';

function makePost(overrides?: Partial<WorkflowPost>): WorkflowPost {
  return {
    id: 1,
    workflow_id: 10,
    titulo: 'Test Post',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 0,
    status: 'aprovado_cliente',
    scheduled_at: '2026-12-01T10:00:00Z',
    ig_caption: 'Test caption #hashtag',
    ...overrides,
  };
}

const defaultProps = {
  hasInstagramAccount: true,
  onStatusChange: vi.fn(),
};

describe('ScheduleButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Visibility ────────────────────────────────────────────

  it('returns null when hasInstagramAccount is false', () => {
    const { container } = render(
      <ScheduleButton post={makePost()} hasInstagramAccount={false} onStatusChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null for unhandled statuses', () => {
    const { container } = render(
      <ScheduleButton post={makePost({ status: 'rascunho' })} {...defaultProps} />,
    );
    expect(container.innerHTML).toBe('');
  });

  // ─── Approved (aprovado_cliente) state ─────────────────────

  describe('aprovado_cliente status', () => {
    it('shows both Agendar and Publicar agora buttons when caption and date are set', () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      expect(screen.getByText('Agendar publicação')).toBeTruthy();
      expect(screen.getByText('Publicar agora')).toBeTruthy();
    });

    it('disables schedule button when scheduled_at is missing', () => {
      render(<ScheduleButton post={makePost({ scheduled_at: null })} {...defaultProps} />);
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
    });

    it('enables publish-now button even without scheduled_at', () => {
      render(<ScheduleButton post={makePost({ scheduled_at: null })} {...defaultProps} />);
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(publishBtn.hasAttribute('disabled')).toBe(false);
    });

    it('disables both buttons when caption is missing', () => {
      render(<ScheduleButton post={makePost({ ig_caption: null })} {...defaultProps} />);
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(publishBtn.hasAttribute('disabled')).toBe(true);
    });

    it('does not require caption for stories', () => {
      render(
        <ScheduleButton post={makePost({ tipo: 'stories', ig_caption: null })} {...defaultProps} />,
      );
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(false);
      expect(publishBtn.hasAttribute('disabled')).toBe(false);
      expect(screen.queryByText(/legenda do Instagram/)).toBeNull();
    });

    it('shows missing items hint when caption is empty', () => {
      render(
        <ScheduleButton
          post={makePost({ ig_caption: '', scheduled_at: null })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/legenda do Instagram/)).toBeTruthy();
    });

    it('calls scheduleInstagramPost on schedule click', async () => {
      vi.mocked(scheduleInstagramPost).mockResolvedValueOnce({ ok: true, status: 'agendado' });
      render(<ScheduleButton post={makePost()} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });

      expect(scheduleInstagramPost).toHaveBeenCalledWith(1);
      expect(toast.success).toHaveBeenCalledWith('Post agendado para publicação no Instagram');
      expect(defaultProps.onStatusChange).toHaveBeenCalled();
    });

    it('shows error toast when schedule fails', async () => {
      vi.mocked(scheduleInstagramPost).mockRejectedValueOnce(
        new Error('Data de publicação não definida.'),
      );
      render(<ScheduleButton post={makePost()} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });

      expect(toast.error).toHaveBeenCalledWith('Data de publicação não definida.');
    });
  });

  // ─── Publish Now dialog ────────────────────────────────────

  describe('publish-now confirmation dialog', () => {
    it('opens confirmation dialog on Publicar agora click', async () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));
      expect(screen.getByText('Publicar agora?')).toBeTruthy();
      expect(screen.getByText(/Esta ação não pode ser desfeita/)).toBeTruthy();
    });

    it('shows Cancelar and Publicar buttons in dialog', () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy();
    });

    it('calls publishInstagramPostNow and shows success toast on postado', async () => {
      vi.mocked(publishInstagramPostNow).mockResolvedValueOnce({
        ok: true,
        status: 'postado',
        instagram_permalink: 'https://instagram.com/p/abc',
      });

      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });

      await waitFor(() => {
        expect(publishInstagramPostNow).toHaveBeenCalledWith(1);
        expect(toast.success).toHaveBeenCalledWith('Post publicado no Instagram!');
        expect(defaultProps.onStatusChange).toHaveBeenCalled();
      });
    });

    it('shows info toast when result is agendado (still processing)', async () => {
      vi.mocked(publishInstagramPostNow).mockResolvedValueOnce({
        ok: true,
        status: 'agendado',
        message: 'Mídia ainda processando no Instagram.',
      });

      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('Mídia ainda processando no Instagram.');
      });
    });

    it('shows error toast when publish fails', async () => {
      vi.mocked(publishInstagramPostNow).mockRejectedValueOnce(
        new Error('Container falhou no processamento do Instagram'),
      );

      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(100);
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Container falhou no processamento do Instagram');
      });
    });

    it('shows progress bar with Publicando title during publish', async () => {
      let resolvePublish: (v: any) => void;
      vi.mocked(publishInstagramPostNow).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePublish = resolve;
        }),
      );

      render(<ScheduleButton post={makePost()} {...defaultProps} />);
      fireEvent.click(screen.getByText('Publicar agora'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });

      expect(screen.getByText('Publicando…')).toBeTruthy();
      expect(screen.getByText('Enviando para o Instagram…')).toBeTruthy();

      await act(async () => {
        resolvePublish!({ ok: true, status: 'postado' });
        await vi.advanceTimersByTimeAsync(1000);
      });
    });
  });

  // ─── Scheduled (agendado) state ────────────────────────────

  describe('agendado status', () => {
    it('shows Agendado badge and Cancelar button', () => {
      render(<ScheduleButton post={makePost({ status: 'agendado' })} {...defaultProps} />);
      expect(screen.getByText('Agendado')).toBeTruthy();
      expect(screen.getByText('Cancelar')).toBeTruthy();
    });

    it('calls cancelInstagramSchedule on Cancelar click', async () => {
      vi.mocked(cancelInstagramSchedule).mockResolvedValueOnce({ ok: true });
      render(<ScheduleButton post={makePost({ status: 'agendado' })} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Cancelar'));
      });

      expect(cancelInstagramSchedule).toHaveBeenCalledWith(1);
      expect(toast.success).toHaveBeenCalledWith('Agendamento cancelado');
      expect(defaultProps.onStatusChange).toHaveBeenCalled();
    });

    it('shows error toast when cancel fails', async () => {
      vi.mocked(cancelInstagramSchedule).mockRejectedValueOnce(new Error('Erro ao cancelar'));
      render(<ScheduleButton post={makePost({ status: 'agendado' })} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Cancelar'));
      });

      expect(toast.error).toHaveBeenCalledWith('Erro ao cancelar');
    });
  });

  // ─── Failed (falha_publicacao) state ───────────────────────

  describe('falha_publicacao status', () => {
    it('shows retry button', () => {
      render(<ScheduleButton post={makePost({ status: 'falha_publicacao' })} {...defaultProps} />);
      expect(screen.getByText('Tentar novamente')).toBeTruthy();
    });

    it('shows publish error message when present', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'falha_publicacao', publish_error: 'Token expirado' })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText('Token expirado')).toBeTruthy();
    });

    it('does not show error text when publish_error is null', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'falha_publicacao', publish_error: null })}
          {...defaultProps}
        />,
      );
      expect(screen.queryByText('Token expirado')).toBeNull();
    });

    it('calls retryInstagramPublish on retry click', async () => {
      vi.mocked(retryInstagramPublish).mockResolvedValueOnce({ ok: true });
      render(<ScheduleButton post={makePost({ status: 'falha_publicacao' })} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });

      expect(retryInstagramPublish).toHaveBeenCalledWith(1);
      expect(toast.success).toHaveBeenCalledWith('Post reenviado para publicação');
      expect(defaultProps.onStatusChange).toHaveBeenCalled();
    });

    it('shows error toast when retry fails', async () => {
      vi.mocked(retryInstagramPublish).mockRejectedValueOnce(new Error('Erro ao reenviar'));
      render(<ScheduleButton post={makePost({ status: 'falha_publicacao' })} {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });

      expect(toast.error).toHaveBeenCalledWith('Erro ao reenviar');
    });
  });

  // ─── Account status warnings ──────────────────────────────

  describe('igAccountStatus warnings', () => {
    const revokedStatus = { revoked: true, expired: false, canPublish: true };
    const expiredStatus = { revoked: false, expired: true, canPublish: true };
    const noPublishPermission = { revoked: false, expired: false, canPublish: false };

    it('shows revoked warning and disables buttons for aprovado_cliente', () => {
      render(
        <ScheduleButton post={makePost()} {...defaultProps} igAccountStatus={revokedStatus} />,
      );
      expect(screen.getByText(/Token do Instagram foi revogado/)).toBeTruthy();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(publishBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows expired warning and disables buttons for aprovado_cliente', () => {
      render(
        <ScheduleButton post={makePost()} {...defaultProps} igAccountStatus={expiredStatus} />,
      );
      expect(screen.getByText(/Token do Instagram expirou/)).toBeTruthy();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows missing permission warning and disables buttons', () => {
      render(
        <ScheduleButton
          post={makePost()}
          {...defaultProps}
          igAccountStatus={noPublishPermission}
        />,
      );
      expect(screen.getByText(/Permissão de publicação não concedida/)).toBeTruthy();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(publishBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows warning banner for agendado status with revoked token', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado' })}
          {...defaultProps}
          igAccountStatus={revokedStatus}
        />,
      );
      expect(screen.getByText(/Token do Instagram foi revogado/)).toBeTruthy();
      expect(screen.getByText('Agendado')).toBeTruthy();
    });

    it('shows warning and disables retry for falha_publicacao with revoked token', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'falha_publicacao' })}
          {...defaultProps}
          igAccountStatus={revokedStatus}
        />,
      );
      expect(screen.getByText(/Token do Instagram foi revogado/)).toBeTruthy();
      const retryBtn = screen.getByText('Tentar novamente').closest('button')!;
      expect(retryBtn.hasAttribute('disabled')).toBe(true);
    });

    it('does not show warning when account status is healthy', () => {
      const healthyStatus = { revoked: false, expired: false, canPublish: true };
      render(
        <ScheduleButton post={makePost()} {...defaultProps} igAccountStatus={healthyStatus} />,
      );
      expect(screen.queryByText(/Token do Instagram/)).toBeNull();
      expect(screen.queryByText(/Permissão de publicação/)).toBeNull();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(false);
    });
  });

  // ─── Platform-based visibility (tiktok bypasses the IG-account gate) ──────

  describe('platform-based visibility', () => {
    it('still returns null for platform instagram when hasInstagramAccount is false (unchanged)', () => {
      const { container } = render(
        <ScheduleButton post={makePost()} hasInstagramAccount={false} onStatusChange={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders for platform tiktok even when hasInstagramAccount is false', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          hasInstagramAccount={false}
          onStatusChange={vi.fn()}
          tiktokSettingsComplete
        />,
      );
      expect(screen.getByText('Agendar publicação')).toBeTruthy();
    });

    it('returns null for platform both when hasInstagramAccount is false', () => {
      const { container } = render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          hasInstagramAccount={false}
          onStatusChange={vi.fn()}
          tiktokSettingsComplete
        />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  // ─── Platform routing — schedule (aprovado_cliente) ────────────────────────

  describe('platform routing — schedule', () => {
    it('platform instagram (explicit) still routes to scheduleInstagramPost', async () => {
      vi.mocked(scheduleInstagramPost).mockResolvedValueOnce({ ok: true, status: 'agendado' });
      render(<ScheduleButton post={makePost({ platform: 'instagram' })} {...defaultProps} />);
      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });
      expect(scheduleInstagramPost).toHaveBeenCalledWith(1);
      expect(scheduleTikTokPost).not.toHaveBeenCalled();
    });

    it('platform tiktok routes to scheduleTikTokPost with scheduled_at, not instagram', async () => {
      vi.mocked(scheduleTikTokPost).mockResolvedValueOnce({ ok: true, status: 'agendado' });
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });
      expect(scheduleTikTokPost).toHaveBeenCalledWith(1, '2026-12-01T10:00:00Z');
      expect(scheduleInstagramPost).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Post agendado para publicação no TikTok');
    });

    it('platform both routes to scheduleTikTokPost (server validates both platforms)', async () => {
      vi.mocked(scheduleTikTokPost).mockResolvedValueOnce({ ok: true, status: 'agendado' });
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });
      expect(scheduleTikTokPost).toHaveBeenCalledWith(1, '2026-12-01T10:00:00Z');
      expect(scheduleInstagramPost).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Post agendado para publicação no Instagram e no TikTok',
      );
    });

    it('flags onTikTokUnaudited when the schedule error contains the unaudited-mode message', async () => {
      vi.mocked(scheduleTikTokPost).mockRejectedValueOnce(new Error(TIKTOK_UNAUDITED_MESSAGE));
      const onTikTokUnaudited = vi.fn();
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete
          onTikTokUnaudited={onTikTokUnaudited}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });
      expect(onTikTokUnaudited).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(TIKTOK_UNAUDITED_MESSAGE);
    });

    it('does not flag onTikTokUnaudited for an unrelated TikTok schedule error', async () => {
      vi.mocked(scheduleTikTokPost).mockRejectedValueOnce(new Error('Falha de rede'));
      const onTikTokUnaudited = vi.fn();
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete
          onTikTokUnaudited={onTikTokUnaudited}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Agendar publicação'));
      });
      expect(onTikTokUnaudited).not.toHaveBeenCalled();
    });
  });

  // ─── Platform routing — publish-now ─────────────────────────────────────────

  describe('platform routing — publish-now', () => {
    it('platform tiktok calls publishTikTokPostNow, not instagram', async () => {
      vi.mocked(publishTikTokPostNow).mockResolvedValueOnce({ ok: true, status: 'postado' });
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(publishTikTokPostNow).toHaveBeenCalledWith(1);
        expect(publishInstagramPostNow).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Post publicado no TikTok!');
      });
    });

    it('platform tiktok shows info toast when TikTok is still processing', async () => {
      vi.mocked(publishTikTokPostNow).mockResolvedValueOnce({
        ok: true,
        status: 'agendado',
        message: 'TikTok ainda processando.',
      });
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('TikTok ainda processando.');
      });
    });

    it('platform both calls publishInstagramPostNow THEN publishTikTokPostNow sequentially', async () => {
      const callOrder: string[] = [];
      vi.mocked(publishInstagramPostNow).mockImplementationOnce(async () => {
        callOrder.push('ig');
        return { ok: true, status: 'postado' };
      });
      vi.mocked(publishTikTokPostNow).mockImplementationOnce(async () => {
        callOrder.push('tt');
        return { ok: true, status: 'postado' };
      });
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(callOrder).toEqual(['ig', 'tt']);
        expect(toast.success).toHaveBeenCalledWith(
          'Post enviado para publicação no Instagram e no TikTok!',
        );
      });
    });

    it('platform both still attempts TikTok even when Instagram fails, surfacing each error separately', async () => {
      vi.mocked(publishInstagramPostNow).mockRejectedValueOnce(new Error('Container falhou'));
      vi.mocked(publishTikTokPostNow).mockResolvedValueOnce({ ok: true, status: 'postado' });
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(publishTikTokPostNow).toHaveBeenCalledWith(1);
        expect(toast.error).toHaveBeenCalledWith('Instagram: Container falhou');
      });
    });

    it('platform both surfaces a TikTok-only publish-now failure', async () => {
      vi.mocked(publishInstagramPostNow).mockResolvedValueOnce({ ok: true, status: 'postado' });
      vi.mocked(publishTikTokPostNow).mockRejectedValueOnce(new Error('TikTok falhou'));
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('TikTok: TikTok falhou');
      });
    });

    it('platform both surfaces combined errors when both sides fail', async () => {
      vi.mocked(publishInstagramPostNow).mockRejectedValueOnce(new Error('IG falhou'));
      vi.mocked(publishTikTokPostNow).mockRejectedValueOnce(new Error('TT falhou'));
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Instagram: IG falhou; TikTok: TT falhou');
      });
    });

    it('flags onTikTokUnaudited from a both publish-now attempt when TikTok 422s as unaudited', async () => {
      vi.mocked(publishInstagramPostNow).mockResolvedValueOnce({ ok: true, status: 'postado' });
      vi.mocked(publishTikTokPostNow).mockRejectedValueOnce(new Error(TIKTOK_UNAUDITED_MESSAGE));
      const onTikTokUnaudited = vi.fn();
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete
          onTikTokUnaudited={onTikTokUnaudited}
        />,
      );
      fireEvent.click(screen.getByText('Publicar agora'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => {
        expect(onTikTokUnaudited).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ─── Platform routing — cancel (agendado) ───────────────────────────────────

  describe('platform routing — cancel', () => {
    it('platform tiktok cancel calls cancelTikTokSchedule, not instagram', async () => {
      vi.mocked(cancelTikTokSchedule).mockResolvedValueOnce({ ok: true });
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado', platform: 'tiktok' })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Cancelar'));
      });
      expect(cancelTikTokSchedule).toHaveBeenCalledWith(1);
      expect(cancelInstagramSchedule).not.toHaveBeenCalled();
    });

    it('platform both cancel calls cancelTikTokSchedule (server validates both platforms)', async () => {
      vi.mocked(cancelTikTokSchedule).mockResolvedValueOnce({ ok: true });
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado', platform: 'both' })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Cancelar'));
      });
      expect(cancelTikTokSchedule).toHaveBeenCalledWith(1);
      expect(cancelInstagramSchedule).not.toHaveBeenCalled();
    });
  });

  // ─── Platform routing — retry (falha_publicacao, failed-side targeting) ────

  describe('platform routing — retry', () => {
    it('platform tiktok retries via retryTikTokPublish, not instagram', async () => {
      vi.mocked(retryTikTokPublish).mockResolvedValueOnce({ ok: true });
      render(
        <ScheduleButton
          post={makePost({ status: 'falha_publicacao', platform: 'tiktok' })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });
      expect(retryTikTokPublish).toHaveBeenCalledWith(1);
      expect(retryInstagramPublish).not.toHaveBeenCalled();
    });

    it('platform both retries only Instagram when only the Instagram side failed', async () => {
      vi.mocked(retryInstagramPublish).mockResolvedValueOnce({ ok: true });
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'both',
            publish_error: 'IG erro',
            instagram_media_id: null,
            tiktok_publish_status: null,
          })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });
      expect(retryInstagramPublish).toHaveBeenCalledWith(1);
      expect(retryTikTokPublish).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Post reenviado para publicação');
    });

    it('platform both retries only TikTok when only the TikTok side failed', async () => {
      vi.mocked(retryTikTokPublish).mockResolvedValueOnce({ ok: true });
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'both',
            publish_error: null,
            instagram_media_id: 'media_123',
            tiktok_publish_status: 'failed',
          })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });
      expect(retryTikTokPublish).toHaveBeenCalledWith(1);
      expect(retryInstagramPublish).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Post reenviado para publicação');
    });

    it('platform both retries both sides when both failed, combining errors on double failure', async () => {
      vi.mocked(retryInstagramPublish).mockRejectedValueOnce(new Error('IG retry falhou'));
      vi.mocked(retryTikTokPublish).mockRejectedValueOnce(new Error('TT retry falhou'));
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'both',
            publish_error: 'IG erro',
            instagram_media_id: null,
            tiktok_publish_status: 'failed',
          })}
          {...defaultProps}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByText('Tentar novamente'));
      });
      expect(retryInstagramPublish).toHaveBeenCalledWith(1);
      expect(retryTikTokPublish).toHaveBeenCalledWith(1);
      expect(toast.error).toHaveBeenCalledWith(
        'Instagram: IG retry falhou; TikTok: TT retry falhou',
      );
    });
  });

  // ─── TikTok settings completeness gating ────────────────────────────────────

  describe('TikTok settings completeness gating', () => {
    it('disables Agendar/Publicar for platform tiktok until tiktokSettingsComplete is true', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete={false}
        />,
      );
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(publishBtn.hasAttribute('disabled')).toBe(true);
      expect(scheduleBtn.getAttribute('title')).toBe('Complete as configurações do TikTok');
    });

    it('enables Agendar/Publicar for platform tiktok once tiktokSettingsComplete is true', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          tiktokSettingsComplete={true}
        />,
      );
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(false);
      expect(publishBtn.hasAttribute('disabled')).toBe(false);
    });

    it('applies the same gate to platform both', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete={false}
        />,
      );
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows "configurações do TikTok" in the missing-items hint', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          tiktokSettingsComplete={false}
        />,
      );
      expect(screen.getByText(/configurações do TikTok/)).toBeTruthy();
    });

    it('never gates a platform-instagram post on tiktokSettingsComplete (unchanged)', () => {
      render(<ScheduleButton post={makePost()} {...defaultProps} tiktokSettingsComplete={false} />);
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(false);
    });
  });

  // ─── TikTok account-status warnings (ttAccountStatus) ───────────────────────

  describe('ttAccountStatus warnings', () => {
    it('shows a TikTok-revoked warning and disables buttons for platform tiktok', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'tiktok' })}
          {...defaultProps}
          ttAccountStatus={{ revoked: true, expired: false }}
          tiktokSettingsComplete
        />,
      );
      expect(screen.getByText(/Token do TikTok foi revogado/)).toBeTruthy();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows a TikTok-expired warning for platform both', () => {
      render(
        <ScheduleButton
          post={makePost({ platform: 'both' })}
          {...defaultProps}
          ttAccountStatus={{ revoked: false, expired: true }}
          tiktokSettingsComplete
        />,
      );
      expect(screen.getByText(/Token do TikTok expirou/)).toBeTruthy();
    });

    it('ignores ttAccountStatus entirely for platform instagram (unchanged)', () => {
      render(
        <ScheduleButton
          post={makePost()}
          {...defaultProps}
          ttAccountStatus={{ revoked: true, expired: false }}
        />,
      );
      expect(screen.queryByText(/Token do TikTok/)).toBeNull();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(false);
    });

    it('disables retry for platform both when the TikTok token is blocked', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'both',
            tiktok_publish_status: 'failed',
          })}
          {...defaultProps}
          ttAccountStatus={{ revoked: true, expired: false }}
        />,
      );
      const retryBtn = screen.getByText('Tentar novamente').closest('button')!;
      expect(retryBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  // ─── Per-platform status chips ───────────────────────────────────────────────

  describe('per-platform status chips', () => {
    it('does not render any chips for platform instagram', () => {
      render(<ScheduleButton post={makePost({ status: 'agendado' })} {...defaultProps} />);
      expect(screen.queryByText(/TikTok/)).toBeNull();
      expect(screen.queryByText(/Instagram ✓|Instagram ⏳|Instagram ✗/)).toBeNull();
    });

    it('renders a pending TikTok chip for platform tiktok, agendado, null publish status', () => {
      render(
        <ScheduleButton
          post={makePost({ status: 'agendado', platform: 'tiktok', tiktok_publish_status: null })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/TikTok ⏳ pendente/)).toBeTruthy();
      expect(screen.queryByText(/Instagram/)).toBeNull();
    });

    it('renders a "processando" sub-label when tiktok_publish_status is processing', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'agendado',
            platform: 'tiktok',
            tiktok_publish_status: 'processing',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/TikTok ⏳ processando/)).toBeTruthy();
    });

    it('renders a failed TikTok chip in falha_publicacao', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'tiktok',
            tiktok_publish_status: 'failed',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/TikTok ✗ falhou/)).toBeTruthy();
    });

    it('renders a published TikTok chip', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'agendado',
            platform: 'tiktok',
            tiktok_publish_status: 'published',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/TikTok ✓ publicado/)).toBeTruthy();
    });

    it('renders both chips for platform both with mixed state (IG published, TikTok failed)', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'postado',
            platform: 'both',
            instagram_media_id: 'media_123',
            tiktok_publish_status: 'failed',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/Instagram ✓ publicado/)).toBeTruthy();
      expect(screen.getByText(/TikTok ✗ falhou/)).toBeTruthy();
    });

    it('renders an Instagram failed chip when publish_error is set without a media id', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'falha_publicacao',
            platform: 'both',
            publish_error: 'erro',
            instagram_media_id: null,
            tiktok_publish_status: 'published',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/Instagram ✗ falhou/)).toBeTruthy();
      expect(screen.getByText(/TikTok ✓ publicado/)).toBeTruthy();
    });

    it('renders an Instagram pending chip when neither published nor failed, platform both', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'agendado',
            platform: 'both',
            publish_error: null,
            instagram_media_id: null,
            tiktok_publish_status: null,
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/Instagram ⏳ pendente/)).toBeTruthy();
    });
  });

  // ─── postado status (new: only rendered for tiktok/both) ────────────────────

  describe('postado status', () => {
    it('returns null for platform instagram (unchanged — status was already unhandled)', () => {
      const { container } = render(
        <ScheduleButton post={makePost({ status: 'postado' })} {...defaultProps} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders chips with no action buttons for platform tiktok', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'postado',
            platform: 'tiktok',
            tiktok_publish_status: 'published',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/TikTok ✓ publicado/)).toBeTruthy();
      expect(screen.queryByText('Agendar publicação')).toBeNull();
      expect(screen.queryByText('Publicar agora')).toBeNull();
      expect(screen.queryByText('Tentar novamente')).toBeNull();
      expect(screen.queryByText('Cancelar')).toBeNull();
    });

    it('shows a "Ver no TikTok" link pointing at tiktok_post_url', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'postado',
            platform: 'tiktok',
            tiktok_publish_status: 'published',
            tiktok_post_url: 'https://www.tiktok.com/@user/video/123',
          })}
          {...defaultProps}
        />,
      );
      const link = screen.getByText('Ver no TikTok').closest('a')!;
      expect(link.getAttribute('href')).toBe('https://www.tiktok.com/@user/video/123');
    });

    it('sanitizes a javascript: tiktok_post_url to a safe href', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'postado',
            platform: 'tiktok',
            tiktok_publish_status: 'published',
            tiktok_post_url: 'javascript:alert(1)',
          })}
          {...defaultProps}
        />,
      );
      const link = screen.getByText('Ver no TikTok').closest('a')!;
      expect(link.getAttribute('href')).toBe('#');
    });

    it('does not show the TikTok link when tiktok_post_url is absent', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'postado',
            platform: 'tiktok',
            tiktok_publish_status: 'published',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.queryByText('Ver no TikTok')).toBeNull();
    });
  });

  // ─── publicando badge reacts to TikTok in-flight state ──────────────────────

  describe('publicando badge for TikTok in-flight state', () => {
    it('shows Publicando when tiktok_publish_status is initiated even before scheduled_at is due', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'agendado',
            platform: 'tiktok',
            scheduled_at: '2099-01-01T00:00:00Z',
            tiktok_publish_status: 'initiated',
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText('Publicando…')).toBeTruthy();
    });

    it('shows Agendado (not Publicando) when not due and tiktok_publish_status is null', () => {
      render(
        <ScheduleButton
          post={makePost({
            status: 'agendado',
            platform: 'tiktok',
            scheduled_at: '2099-01-01T00:00:00Z',
            tiktok_publish_status: null,
          })}
          {...defaultProps}
        />,
      );
      expect(screen.getByText('Agendado')).toBeTruthy();
    });
  });
});
