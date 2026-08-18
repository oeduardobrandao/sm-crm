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

const { mockUpload, mockGetPublicUrl } = vi.hoisted(() => ({
  mockUpload: vi.fn(async () => ({ error: null })),
  mockGetPublicUrl: vi.fn(() => ({
    data: { publicUrl: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png' },
  })),
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
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
  mockUpload.mockClear();
  mockGetPublicUrl.mockClear();
});

function getFileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('ClienteAvatarUpload', () => {
  it('renders a plain, non-interactive avatar when canEdit is false', () => {
    renderIt({ canEdit: false });
    expect(screen.queryByLabelText(/Alterar foto/)).not.toBeInTheDocument();
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('renders the upload trigger as a real, focusable button (keyboard-reachable)', () => {
    renderIt({ canEdit: true });
    const trigger = screen.getByRole('button', { name: /Alterar foto/ });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).not.toBeDisabled();
  });

  it('clicking the trigger button opens the hidden file picker input', () => {
    const { container } = renderIt({ canEdit: true });
    const input = getFileInput(container);
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: /Alterar foto/ }));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('uploads to a randomized path (not upsert), and calls updateCliente with the resulting public URL, then invalidates both cache keys', async () => {
    const { queryClient, container } = renderIt();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const file = new File(['x'], 'foto.png', { type: 'image/png' });

    const input = getFileInput(container);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(mockedUpdateCliente).toHaveBeenCalledWith(1, {
        foto_url: 'https://cdn.mesaas.com/avatars/clientes/1/foto.png',
      }),
    );
    expect(mockedResize).toHaveBeenCalledWith(file);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^clientes\/1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i,
      ),
      expect.any(Blob),
      { contentType: 'image/png' },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 1] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('uploads two files to two different random paths', async () => {
    const { container } = renderIt();
    const input = getFileInput(container);

    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

    fireEvent.change(input, {
      target: { files: [new File(['x'], 'b.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));

    const [firstPath] = mockUpload.mock.calls[0];
    const [secondPath] = mockUpload.mock.calls[1];
    expect(firstPath).not.toBe(secondPath);
  });

  it('rejects a file over 2MB without calling resize or updateCliente', async () => {
    const { container } = renderIt();
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });

    const input = getFileInput(container);
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
