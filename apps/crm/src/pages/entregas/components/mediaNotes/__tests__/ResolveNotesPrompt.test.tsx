import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResolveNotesPrompt } from '../ResolveNotesPrompt';

describe('ResolveNotesPrompt', () => {
  it('asks and confirms', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ResolveNotesPrompt open count={2} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(
      screen.getByText('Marcar como resolvidos os 2 comentários deste slide?'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('cancels with Agora não', async () => {
    const onCancel = vi.fn();
    render(<ResolveNotesPrompt open count={2} onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('uses the singular for one comment', () => {
    render(<ResolveNotesPrompt open count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Marcar como resolvido o comentário deste slide?')).toBeInTheDocument();
  });

  it('confirm reads in the singular for one comment', () => {
    render(<ResolveNotesPrompt open count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Marcar como resolvido' })).toBeInTheDocument();
  });

  it('says vídeo for a video', () => {
    render(
      <ResolveNotesPrompt open count={3} kind="video" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByText('Marcar como resolvidos os 3 comentários deste vídeo?'),
    ).toBeInTheDocument();
  });

  it('does not claim the comments are client-only and has no em dash', () => {
    render(<ResolveNotesPrompt open count={2} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('—');
    expect(text).toMatch(/notas internas/);
  });

  it('confirming does not also report a cancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ResolveNotesPrompt open count={2} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancelling reports a single cancel', async () => {
    const onCancel = vi.fn();
    render(<ResolveNotesPrompt open count={2} onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(<ResolveNotesPrompt open={false} count={2} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
  });
});
