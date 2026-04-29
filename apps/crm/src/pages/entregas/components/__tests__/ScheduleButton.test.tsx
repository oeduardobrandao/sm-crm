import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPost } from '../../../../store';

vi.mock('../../../../services/instagram', () => ({
  scheduleInstagramPost: vi.fn(),
  cancelInstagramSchedule: vi.fn(),
  retryInstagramPublish: vi.fn(),
  publishInstagramPostNow: vi.fn(),
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
import { toast } from 'sonner';

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

    it('shows missing items hint when caption is empty', () => {
      render(<ScheduleButton post={makePost({ ig_caption: '', scheduled_at: null })} {...defaultProps} />);
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
      vi.mocked(scheduleInstagramPost).mockRejectedValueOnce(new Error('Data de publicação não definida.'));
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
        new Promise((resolve) => { resolvePublish = resolve; }),
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
        <ScheduleButton post={makePost()} {...defaultProps} igAccountStatus={noPublishPermission} />,
      );
      expect(screen.getByText(/Permissão de publicação não concedida/)).toBeTruthy();
      const scheduleBtn = screen.getByText('Agendar publicação').closest('button')!;
      const publishBtn = screen.getByText('Publicar agora').closest('button')!;
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(publishBtn.hasAttribute('disabled')).toBe(true);
    });

    it('shows warning banner for agendado status with revoked token', () => {
      render(
        <ScheduleButton post={makePost({ status: 'agendado' })} {...defaultProps} igAccountStatus={revokedStatus} />,
      );
      expect(screen.getByText(/Token do Instagram foi revogado/)).toBeTruthy();
      expect(screen.getByText('Agendado')).toBeTruthy();
    });

    it('shows warning and disables retry for falha_publicacao with revoked token', () => {
      render(
        <ScheduleButton post={makePost({ status: 'falha_publicacao' })} {...defaultProps} igAccountStatus={revokedStatus} />,
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
});
