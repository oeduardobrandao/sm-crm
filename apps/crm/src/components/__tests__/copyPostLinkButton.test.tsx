import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyPostLinkButton } from '../CopyPostLinkButton';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });
afterEach(() => vi.clearAllMocks());

describe('CopyPostLinkButton', () => {
  it('renders nothing without a hubUrl', () => {
    const { container } = render(<CopyPostLinkButton postId={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('copies the per-post link and toasts on success', async () => {
    render(<CopyPostLinkButton hubUrl="https://app.mesaas.com.br/acme/hub/tok" postId={5} />);
    fireEvent.click(screen.getByRole('button', { name: /copiar link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.mesaas.com.br/acme/hub/tok/postagens/5'));
    expect(toast.success).toHaveBeenCalledWith('Link copiado!');
  });
});
