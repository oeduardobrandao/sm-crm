import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ can: makeCan(fakeMembership({ role: 'owner' })) })),
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/posts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  searchPostsForMention: vi.fn().mockResolvedValue([]),
}));

import { getMembros, getClientes, getTarefas } from '@/store';
import { AddCommentPopover } from '../AddCommentPopover';

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const position = { top: 10, left: 10 };

describe('AddCommentPopover', () => {
  // The global test setup resets mock implementations between tests, so the mention
  // sources must be re-armed here or useQuery sees `undefined` data.
  beforeEach(() => {
    vi.mocked(getMembros).mockResolvedValue([]);
    vi.mocked(getClientes).mockResolvedValue([]);
    vi.mocked(getTarefas).mockResolvedValue([]);
  });

  it('disables submit until there is text, then submits the trimmed text', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddCommentPopover position={position} onSubmit={onSubmit} onClose={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Comentar' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: '  ajustar o gancho  ' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('ajustar o gancho'));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<AddCommentPopover position={position} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Escreva seu comentário...'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on an outside mousedown but not on an ignored element', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    render(
      <AddCommentPopover
        position={position}
        onSubmit={vi.fn()}
        onClose={onClose}
        ignoreRefs={[{ current: trigger }]}
      />,
    );
    fireEvent.mouseDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});
