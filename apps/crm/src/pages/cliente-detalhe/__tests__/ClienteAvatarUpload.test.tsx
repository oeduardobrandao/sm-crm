import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../clienteFoto', () => ({
  resizeClientePhoto: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
}));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  updateCliente: vi.fn(async () => {}),
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: () => ({
          data: { publicUrl: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png' },
        }),
      }),
    },
  },
}));

import { resizeClientePhoto } from '../clienteFoto';
import { updateCliente } from '../../../store';
import { ClienteAvatarUpload } from '../ClienteAvatarUpload';

const mockedResize = vi.mocked(resizeClientePhoto);
const mockedUpdateCliente = vi.mocked(updateCliente);

function renderIt(props: Partial<React.ComponentProps<typeof ClienteAvatarUpload>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ClienteAvatarUpload
          clienteId={1}
          nome="Aurora Estética"
          cor="#ffbf30"
          initials="AE"
          imageUrl={null}
          canEdit
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mockedResize.mockClear();
  mockedUpdateCliente.mockClear();
});

describe('ClienteAvatarUpload', () => {
  it('renders a plain, non-interactive avatar when canEdit is false', () => {
    renderIt({ canEdit: false });
    expect(screen.queryByRole('button', { name: /Alterar foto/ })).not.toBeInTheDocument();
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('uploads and calls updateCliente with the resulting public URL, then invalidates both cache keys', async () => {
    const { queryClient } = renderIt();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const file = new File(['x'], 'foto.png', { type: 'image/png' });

    const input = screen.getByLabelText(/Alterar foto/, { selector: 'input' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(mockedUpdateCliente).toHaveBeenCalledWith(1, {
        foto_url: expect.stringContaining('https://cdn.mesaas.com/avatars/clientes/1/foto.png'),
      }),
    );
    expect(mockedResize).toHaveBeenCalledWith(file);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 1] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('rejects a file over 2MB without calling resize or updateCliente', async () => {
    renderIt();
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });

    const input = screen.getByLabelText(/Alterar foto/, { selector: 'input' });
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(mockedResize).not.toHaveBeenCalled());
    expect(mockedUpdateCliente).not.toHaveBeenCalled();
  });

  it('shows a remove control only when a photo is set, and confirms before removing', async () => {
    renderIt({ imageUrl: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png' });

    const removeButton = screen.getByRole('button', { name: /Remover foto/ });
    fireEvent.click(removeButton);

    expect(screen.getByText(/Remover a foto do cliente\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledWith(1, { foto_url: null }));
  });

  it('does not show a remove control when there is no photo', () => {
    renderIt({ imageUrl: null });
    expect(screen.queryByRole('button', { name: /Remover foto/ })).not.toBeInTheDocument();
  });
});
