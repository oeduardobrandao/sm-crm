import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { LiveLinkButtons, LiveRowLink } from '../LiveLinkButtons';

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('LiveLinkButtons', () => {
  it('opens the live post in a new tab, tagged as coming from the admin', () => {
    render(<LiveLinkButtons slug="x" />);
    const link = screen.getByRole('link', { name: /Abrir no site/ });
    expect(link).toHaveAttribute('href', 'https://www.mesaas.com.br/blog/x?ref=admin');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('copies the clean URL (no ref) and confirms with a toast', async () => {
    render(<LiveLinkButtons slug="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Link copiado'));
    expect(writeText).toHaveBeenCalledWith('https://www.mesaas.com.br/blog/x');
  });

  it('toasts an error when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<LiveLinkButtons slug="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Não foi possível copiar o link'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('LiveRowLink', () => {
  it('labels the link with the post title and does not trigger the row click', () => {
    const spy = vi.fn();
    render(
      <ul>
        <li onClick={spy}>
          <LiveRowLink slug="x" title="Meu post" />
        </li>
      </ul>,
    );
    const link = screen.getByRole('link', { name: 'Abrir Meu post no site' });
    expect(link).toHaveAttribute('href', 'https://www.mesaas.com.br/blog/x?ref=admin');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(spy).not.toHaveBeenCalled();
  });
});
