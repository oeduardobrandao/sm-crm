import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaNotesList } from '../MediaNotesList';
import type { HubMediaNote } from '../../../../types';

function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
  return {
    id: 1,
    post_id: 10,
    media_kind: 'image',
    link_id: 100,
    slide_index: 2,
    is_previous_version: false,
    t_seconds: null,
    x: 0.4,
    y: 0.4,
    author: 'client',
    author_name: null,
    body: 'Trocar a cor',
    status: 'open',
    resolved_at: null,
    created_at: '2026-10-23T00:00:00Z',
    replies: [],
    ...over,
  };
}

function setup(
  notes: HubMediaNote[],
  over: Partial<React.ComponentProps<typeof MediaNotesList>> = {},
) {
  const props = {
    notes,
    canReply: true,
    onJump: vi.fn(),
    onReply: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  render(<MediaNotesList {...props} />);
  return props;
}

describe('MediaNotesList', () => {
  it('shows Em aberto / Resolvido', () => {
    setup([
      note({ id: 1 }),
      note({ id: 2, status: 'resolved', resolved_at: '2026-10-24T00:00:00Z', body: 'Feito' }),
    ]);
    expect(screen.getByText('Em aberto')).toBeTruthy();
    expect(screen.getByText('Resolvido')).toBeTruthy();
  });

  it('team reply shows Equipe fallback, the client reply shows Você', () => {
    setup([
      note({
        replies: [
          {
            id: 1,
            author: 'team',
            author_name: null,
            body: 'Ajustado',
            created_at: '2026-10-23T01:00:00Z',
          },
          {
            id: 2,
            author: 'client',
            author_name: null,
            body: 'Valeu',
            created_at: '2026-10-23T02:00:00Z',
          },
        ],
      }),
    ]);
    expect(screen.getByText('Equipe')).toBeTruthy();
    expect(screen.getByText('Você')).toBeTruthy();
    expect(screen.getByText('Ajustado')).toBeTruthy();
  });

  it('uses the team member name when given', () => {
    setup([
      note({
        replies: [
          {
            id: 1,
            author: 'team',
            author_name: 'Ana',
            body: 'Ajustado',
            created_at: '2026-10-23T01:00:00Z',
          },
        ],
      }),
    ]);
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('no reply field when canReply false', () => {
    setup([note()], { canReply: false });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('anchor chip calls onJump', () => {
    const n = note({ x: null, y: null });
    const { onJump } = setup([n]);
    fireEvent.click(screen.getByRole('button', { name: 'Slide 3' }));
    expect(onJump).toHaveBeenCalledWith(n);
  });

  it('numbers pinned notes per slide in the chip', () => {
    setup([note({ id: 1 }), note({ id: 2, body: 'Outra', created_at: '2026-10-23T00:01:00Z' })]);
    expect(screen.getByRole('button', { name: 'Slide 3 · ponto 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Slide 3 · ponto 2' })).toBeTruthy();
  });

  it('sends a trimmed reply and clears the field', async () => {
    const { onReply } = setup([note({ id: 5 })]);
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '  Obrigado  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith(5, 'Obrigado'));
    await waitFor(() => expect(field.value).toBe(''));
  });

  it('keeps the reply text and shows the error when sending fails', async () => {
    setup([note()], { onReply: vi.fn().mockRejectedValue(new Error('x')) });
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Obrigado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(await screen.findByText('Não foi possível enviar. Tente novamente.')).toBeTruthy();
    expect(field.value).toBe('Obrigado');
  });
});
