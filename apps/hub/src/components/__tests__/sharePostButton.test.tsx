import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubContext } from '../../HubContext';
import { SharePostButton } from '../SharePostButton';

const hubValue = {
  bootstrap: { workspace: { name: 'Mesaas' } },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;
const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

afterEach(() => vi.clearAllMocks());

describe('SharePostButton', () => {
  it('copies the absolute focused-post URL and shows confirmation', async () => {
    render(
      <HubContext.Provider value={hubValue}>
        <SharePostButton postId={42} />
      </HubContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /compartilhar|copiar link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('/mesaas/hub/token-publico/postagens/42');
    expect(await screen.findByText(/copiado/i)).toBeInTheDocument();
  });
});
