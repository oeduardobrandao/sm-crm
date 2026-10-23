import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaNoteComposer } from '../MediaNoteComposer';

function setup(over: Partial<React.ComponentProps<typeof MediaNoteComposer>> = {}) {
  const props = {
    open: true,
    title: 'Comentário em 0:42',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    onOverlayChange: vi.fn(),
    ...over,
  };
  render(<MediaNoteComposer {...props} />);
  return props;
}

const field = () => screen.getByPlaceholderText('O que você quer mudar aqui?');

describe('MediaNoteComposer', () => {
  it('submits trimmed body', async () => {
    const { onSubmit } = setup();
    fireEvent.change(field(), { target: { value: '  Trocar a cor  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Trocar a cor'));
  });

  it('disables send while the body is blank', () => {
    setup();
    fireEvent.change(field(), { target: { value: '   ' } });
    expect(
      (screen.getByRole('button', { name: 'Enviar comentário' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps text and shows error when onSubmit rejects', async () => {
    setup({ onSubmit: vi.fn().mockRejectedValue(new Error('x')) });
    fireEvent.change(field(), { target: { value: 'Trocar a cor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    expect(await screen.findByText('Não foi possível enviar. Tente novamente.')).toBeTruthy();
    expect((field() as HTMLTextAreaElement).value).toBe('Trocar a cor');
  });

  it('calls onOverlayChange(true) when open and false on close', () => {
    const onOverlayChange = vi.fn();
    const { unmount } = render(
      <MediaNoteComposer
        open
        title="t"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onOverlayChange={onOverlayChange}
      />,
    );
    expect(onOverlayChange).toHaveBeenCalledWith(true);
    unmount();
    expect(onOverlayChange).toHaveBeenLastCalledWith(false);
  });

  it('cancel button calls onCancel', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByPlaceholderText('O que você quer mudar aqui?')).toBeNull();
  });
});
