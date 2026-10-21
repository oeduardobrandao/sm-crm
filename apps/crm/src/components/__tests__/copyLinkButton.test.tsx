import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyLinkButton } from '../CopyLinkButton';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });
afterEach(() => vi.clearAllMocks());

describe('CopyLinkButton', () => {
  it('copies the absolute app link (origin + path) and toasts on success', async () => {
    render(<CopyLinkButton path="/entregas?post=5" label="Copiar link do post" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link do post' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/entregas?post=5`),
    );
    expect(toast.success).toHaveBeenCalledWith('Link copiado!');
  });

  it('toasts an error when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyLinkButton path="/entregas?drawer=9" label="Copiar link do fluxo" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link do fluxo' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível copiar o link.'),
    );
  });
});
