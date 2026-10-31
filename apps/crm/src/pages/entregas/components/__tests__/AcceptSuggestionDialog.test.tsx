import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));

import { AcceptSuggestionDialog } from '../AcceptSuggestionDialog';
import type { SuggestionField } from '../../editSuggestionFields';

afterEach(cleanup);

function setup(conflicts: SuggestionField[], applied: SuggestionField[]) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AcceptSuggestionDialog
      open
      conflicts={conflicts}
      applied={applied}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe('AcceptSuggestionDialog', () => {
  it('names the conflicting field and keeps the team version by default', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup(['legenda'], ['texto']);

    expect(screen.getByRole('heading', { name: 'Aceitar a sugestão?' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A equipe editou a legenda do Instagram depois que o cliente enviou a sugestão. Escolha qual versão fica.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Manter a versão da equipe' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Usar a versão do cliente' })).not.toBeChecked();
    // The non-conflicting field is listed as applied.
    expect(screen.getByText('Só o cliente mudou. Será aplicado.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onConfirm).toHaveBeenCalledWith(['texto']);
  });

  it('applies the conflicting field too when the client version is chosen', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup(['legenda'], ['texto']);

    await user.click(screen.getByRole('radio', { name: 'Usar a versão do cliente' }));
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onConfirm).toHaveBeenCalledWith(['texto', 'legenda']);
  });

  it('disables the confirm button when nothing would be applied, and enables it on a choice', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup(['legenda'], []);

    const confirm = screen.getByRole('button', { name: 'Aceitar sugestão' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Usar a versão do cliente' }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(['legenda']);
  });

  it('asks per field when both conflict', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup(['texto', 'legenda'], []);

    expect(
      screen.getByText(
        'A equipe editou o texto e a legenda do Instagram depois que o cliente enviou a sugestão. Escolha qual versão fica.',
      ),
    ).toBeInTheDocument();
    const clientChoices = screen.getAllByRole('radio', { name: 'Usar a versão do cliente' });
    expect(clientChoices).toHaveLength(2);
    // Client version for legenda only.
    await user.click(clientChoices[1]);
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onConfirm).toHaveBeenCalledWith(['legenda']);
  });

  it('lists TikTok and Geral by name, and sends the fields in canonical order', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup(['legenda_geral', 'legenda'], ['legenda_tiktok']);

    expect(
      screen.getByText(
        'A equipe editou a legenda Geral e a legenda do Instagram depois que o cliente enviou a sugestão. Escolha qual versão fica.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Legenda do TikTok')).toBeInTheDocument();
    expect(screen.getByText('Legenda Geral')).toBeInTheDocument();
    const clientChoices = screen.getAllByRole('radio', { name: 'Usar a versão do cliente' });
    // Geral first (the order the conflicts came in), then Instagram.
    await user.click(clientChoices[0]);
    await user.click(clientChoices[1]);
    await user.click(screen.getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onConfirm).toHaveBeenCalledWith(['legenda', 'legenda_tiktok', 'legenda_geral']);
  });

  it('Cancelar closes without confirming', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup(['legenda'], ['texto']);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
