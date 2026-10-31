import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));
// Radix keeps the content mounted while it plays its exit animation. jsdom has no animations and
// unmounts at once, so stand in for that window: the content stays rendered whatever `open` says.
vi.mock('@/components/ui/dialog', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (
      <div data-testid="dialog" data-open={String(open)}>
        {children}
      </div>
    ),
    DialogContent: Box,
    DialogHeader: Box,
    DialogFooter: Box,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

import { useAcceptSuggestionFlow } from '../AcceptSuggestionDialog';
import type { PostEditSuggestion } from '@/store/posts';

afterEach(cleanup);

const post = {
  conteudo: null,
  conteudo_plain: 'Texto',
  ig_caption: 'Legenda da equipe',
  tiktok_caption: null,
};
// The client changed texto and legenda; the team edited the legenda since.
const clash: PostEditSuggestion = {
  id: 1,
  post_id: 2,
  suggested_conteudo: { type: 'doc', content: [] },
  suggested_conteudo_plain: 'Texto do cliente',
  suggested_ig_caption: 'Legenda do cliente',
  original_conteudo: null,
  original_conteudo_plain: 'Texto',
  original_ig_caption: 'Legenda base',
  suggested_tiktok_caption: null,
  original_tiktok_caption: null,
  suggested_geral_caption: null,
  original_geral_caption: null,
  geral_target_id: null,
  tiktok_followed_ig: null,
  changed_fields: ['conteudo', 'ig_caption'],
  status: 'pending',
  updated_at: '2026-10-28T20:33:00Z',
};

function Harness({
  onAccept,
}: {
  onAccept: (s: PostEditSuggestion, f: string[], ack: string[]) => void;
}) {
  const flow = useAcceptSuggestionFlow(post, onAccept);
  return (
    <>
      <button type="button" onClick={() => flow.request(clash)}>
        abrir
      </button>
      {flow.dialog}
    </>
  );
}

describe('useAcceptSuggestionFlow, dialog while it closes', () => {
  async function openDialog() {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<Harness onAccept={onAccept} />);
    await user.click(screen.getByRole('button', { name: 'abrir' }));
    expect(screen.getByTestId('dialog')).toHaveAttribute('data-open', 'true');
    return { user, onAccept };
  }

  function expectContentIntact() {
    expect(screen.getByTestId('dialog')).toHaveAttribute('data-open', 'false');
    expect(
      screen.getByText(/A equipe editou a legenda do Instagram depois que o cliente enviou/),
    ).toBeInTheDocument();
    expect(screen.getByText('Legenda do Instagram')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Manter a versão da equipe' })).toBeInTheDocument();
    expect(screen.getByText('Só o cliente mudou. Será aplicado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceitar sugestão' })).toBeEnabled();
  }

  it('keeps the field name, fieldsets and confirm button after Aceitar sugestão', async () => {
    const { user, onAccept } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onAccept).toHaveBeenCalledWith(clash, ['texto'], []);
    expectContentIntact();
  });

  it('acknowledges the conflicts the reviewer takes from the client', async () => {
    const { user, onAccept } = await openDialog();
    await user.click(screen.getByRole('radio', { name: 'Usar a versão do cliente' }));
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onAccept).toHaveBeenCalledWith(clash, ['texto', 'legenda'], ['legenda']);
  });

  it('keeps them after Cancelar too, and does not accept', async () => {
    const { user, onAccept } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onAccept).not.toHaveBeenCalled();
    expectContentIntact();
  });

  it('a second click on Aceitar sugestão during the fade-out does not accept twice', async () => {
    const { user, onAccept } = await openDialog();
    const confirm = screen.getByRole('button', { name: 'Aceitar sugestão' });
    await user.click(confirm);
    await user.click(confirm);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
