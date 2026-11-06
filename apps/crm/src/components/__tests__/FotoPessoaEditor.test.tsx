import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FotoAlvo } from '@/store/team';

const foto = vi.hoisted(() => ({
  uploading: false,
  pick: vi.fn(),
  pickCamera: vi.fn(),
  upload: vi.fn(async () => true),
  remove: vi.fn(async () => {}),
  inputProps: {
    ref: { current: null },
    type: 'file' as const,
    accept: 'image/*',
    disabled: false,
    onChange: vi.fn(),
  },
  cameraInputProps: {
    ref: { current: null },
    type: 'file' as const,
    accept: 'image/*',
    capture: 'user' as const,
    disabled: false,
    onChange: vi.fn(),
  },
}));
const useFotoPessoa = vi.hoisted(() => vi.fn((_alvo: unknown) => foto));
vi.mock('@/hooks/useFotoPessoa', () => ({ useFotoPessoa }));

import { FotoPessoaEditor } from '../FotoPessoaEditor';

const ALVO: FotoAlvo = { kind: 'membro', membroId: 42 };

function renderIt(props: Partial<React.ComponentProps<typeof FotoPessoaEditor>> = {}) {
  return render(
    <MemoryRouter>
      <FotoPessoaEditor alvo={ALVO} nome="Ana Lima" fotoUrl={null} variant="desktop" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  foto.uploading = false;
});

describe('FotoPessoaEditor (desktop)', () => {
  it('passes the target to the upload hook', () => {
    renderIt();
    expect(useFotoPessoa).toHaveBeenCalledWith(ALVO);
  });

  it('offers to add a photo when there is none', () => {
    const { container } = renderIt();
    expect(screen.getByRole('button', { name: 'Adicionar foto de Ana Lima' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar foto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover foto' })).toBeNull();
    expect(
      screen.getByText('JPG, PNG ou HEIC até 10 MB. A foto é recortada em quadrado.'),
    ).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
  });

  it('offers to change and remove an existing photo', () => {
    const { container } = renderIt({ fotoUrl: 'https://x/a.jpg' });
    expect(screen.getByRole('button', { name: 'Alterar foto de Ana Lima' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alterar foto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/a.jpg');
  });

  it('opens the picker from the camera button and the text button', () => {
    renderIt({ fotoUrl: 'https://x/a.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Alterar foto de Ana Lima' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alterar foto' }));
    expect(foto.pick).toHaveBeenCalledTimes(2);
  });

  it('shows the description when given', () => {
    renderIt({ descricao: 'Aparece para a sua equipe.' });
    expect(screen.getByText('Aparece para a sua equipe.')).toBeInTheDocument();
  });

  it('confirms before removing', async () => {
    renderIt({ fotoUrl: 'https://x/a.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remover a foto?')).toBeInTheDocument();
    expect(within(dialog).getByText('Volta a aparecer as iniciais.')).toBeInTheDocument();
    expect(foto.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(foto.remove).toHaveBeenCalledTimes(1));
  });

  it('disables the controls while uploading', () => {
    foto.uploading = true;
    renderIt({ fotoUrl: 'https://x/a.jpg' });
    expect(screen.getByRole('button', { name: 'Alterar foto de Ana Lima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alterar foto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeDisabled();
  });
});

describe('FotoPessoaEditor (phone)', () => {
  it('opens the photo sheet with gallery and camera, without remove when there is no photo', async () => {
    renderIt({ variant: 'phone' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar foto de Ana Lima' }));

    const sheet = await screen.findByRole('dialog', { name: 'Foto de perfil' });
    expect(within(sheet).getByRole('button', { name: 'Escolher da galeria' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Tirar foto' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Remover foto' })).toBeNull();
  });

  it('opens the gallery and the front camera inside the tap', async () => {
    renderIt({ variant: 'phone' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar foto' }));
    let sheet = await screen.findByRole('dialog', { name: 'Foto de perfil' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Escolher da galeria' }));
    expect(foto.pick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar foto' }));
    sheet = await screen.findByRole('dialog', { name: 'Foto de perfil' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tirar foto' }));
    expect(foto.pickCamera).toHaveBeenCalledTimes(1);
  });

  it('removes after confirming from the sheet', async () => {
    renderIt({ variant: 'phone', fotoUrl: 'https://x/a.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Alterar foto de Ana Lima' }));
    const sheet = await screen.findByRole('dialog', { name: 'Foto de perfil' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remover foto' }));

    const confirm = await screen.findByRole('dialog', { name: 'Remover a foto?' });
    expect(within(confirm).getByText('Volta a aparecer as iniciais.')).toBeInTheDocument();
    expect(foto.remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(foto.remove).toHaveBeenCalledTimes(1));
  });
});
