import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastError, toastSuccess, updateWorkflowPost, scheduleApprovedPost } = vi.hoisted(() => {
  return {
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    updateWorkflowPost: vi.fn(),
    scheduleApprovedPost: vi.fn(),
  };
});

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess, info: vi.fn() } }));

vi.mock('@/store', () => ({ updateWorkflowPost }));

vi.mock('../../scheduleApprovedPost', () => ({
  scheduleApprovedPost,
  scheduleSuccessMessage: () => 'Post agendado para publicação no Instagram',
}));

// The real DateTimePicker is a Popover + Calendar; in jsdom it is simpler and
// more robust to drive a stub that exposes one button emitting a fixed Date.
const PICKED = new Date('2026-09-20T15:00:00.000Z');
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: ({
    value,
    onChange,
  }: {
    value?: Date;
    onChange?: (d: Date | undefined) => void;
  }) => (
    <div>
      <span data-testid="picker-value">{value ? value.toISOString() : 'empty'}</span>
      <button onClick={() => onChange?.(PICKED)}>escolher data</button>
    </div>
  ),
}));

import { AutoSchedulePromptDialog } from '../AutoSchedulePromptDialog';

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

describe('AutoSchedulePromptDialog', () => {
  beforeEach(() => {
    updateWorkflowPost.mockReset();
    scheduleApprovedPost.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    scheduleApprovedPost.mockResolvedValue({ ok: true, status: 'agendado' });
  });

  it('renders nothing when post is null', () => {
    const { container } = render(
      <AutoSchedulePromptDialog post={null} onClose={vi.fn()} onScheduled={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('confirm branch: schedules the post as-is when the date is already eligible', async () => {
    const onScheduled = vi.fn();
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={vi.fn()}
        onScheduled={onScheduled}
      />,
    );
    expect(screen.queryByText('escolher data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(1));
    expect(scheduleApprovedPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, scheduled_at: FUTURE }),
    );
    expect(updateWorkflowPost).not.toHaveBeenCalled();
    expect(onScheduled).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('date branch: offers the picker pre-filled with the stale date', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 12, titulo: 'Post B', platform: 'instagram', scheduled_at: PAST }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('picker-value')).toHaveTextContent(new Date(PAST).toISOString());
    expect(screen.getByRole('button', { name: /Definir e agendar/ })).toBeDisabled();
  });

  it('date branch: an empty scheduled_at opens the picker with no value', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 13, titulo: 'Post C', platform: 'instagram', scheduled_at: null }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('picker-value')).toHaveTextContent('empty');
  });

  // The specific regression Codex caught: for tiktok/both, scheduleApprovedPost
  // reads scheduled_at off the object it is handed. Handing it the closure's
  // original post would send the OLD date (or null) to the TikTok endpoint.
  it('date branch: schedules with the row updateWorkflowPost returned, not the original post', async () => {
    updateWorkflowPost.mockResolvedValue({
      id: 14,
      titulo: 'Post D',
      platform: 'both',
      scheduled_at: PICKED.toISOString(),
      status: 'aprovado_cliente',
    });
    render(
      <AutoSchedulePromptDialog
        post={{ id: 14, titulo: 'Post D', platform: 'both', scheduled_at: PAST }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('escolher data'));
    fireEvent.click(screen.getByRole('button', { name: /Definir e agendar/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(1));
    expect(updateWorkflowPost).toHaveBeenCalledWith(14, {
      scheduled_at: PICKED.toISOString(),
    });
    expect(scheduleApprovedPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 14, platform: 'both', scheduled_at: PICKED.toISOString() }),
    );
    // Guard against a regression that passes the prop object instead.
    expect(scheduleApprovedPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduled_at: PAST }),
    );
  });

  it('an endpoint error closes the dialog and toasts the message', async () => {
    const onClose = vi.fn();
    const onScheduled = vi.fn();
    scheduleApprovedPost.mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'));
    render(
      <AutoSchedulePromptDialog
        post={{ id: 15, titulo: 'Post E', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={onClose}
        onScheduled={onScheduled}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Legenda do Instagram não definida.'),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it('Cancelar closes without scheduling', () => {
    const onClose = vi.fn();
    render(
      <AutoSchedulePromptDialog
        post={{ id: 16, titulo: 'Post F', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={onClose}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onClose).toHaveBeenCalled();
    expect(scheduleApprovedPost).not.toHaveBeenCalled();
  });
});
