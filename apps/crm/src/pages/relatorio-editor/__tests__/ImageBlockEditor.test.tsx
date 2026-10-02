import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  uploadFile: vi.fn(),
  getClientReportsFolderId: vi.fn(),
  getClientFolderId: vi.fn(),
}));
vi.mock('@/hooks/useFileUrl', () => ({ useFileUrl: vi.fn(), seedImageUrl: vi.fn() }));
vi.mock('../reportImageUpload', async (orig) => ({
  ...(await orig<object>()),
  prepareReportImage: vi.fn(async (file: File) => ({ file, width: 1600, height: 900 })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { getClientReportsFolderId, uploadFile } from '@/services/fileService';
import { useFileUrl } from '@/hooks/useFileUrl';
import { ImageBlockEditor, type ImageEditorContext } from '../ImageBlockEditor';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const empty: ReportBlock = { id: 'i', type: 'image', size: 'full' };
const filled: ReportBlock = {
  id: 'i',
  type: 'image',
  size: 'full',
  config: { file_id: 5, width: 1600, height: 900, alt: 'Equipe' },
};

function setup(block: ReportBlock, context: ImageEditorContext = { mode: 'report', clientId: 7 }) {
  const onConfigChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImageBlockEditor
        block={block}
        snapshot={makeSnapshotFixture()}
        context={context}
        onConfigChange={onConfigChange}
        onSizeChange={vi.fn()}
        settingsOpen={false}
        onSettingsOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onConfigChange };
}

const loaded = () =>
  ({ data: 'blob:img', isLoading: false, isError: false, refetch: vi.fn() }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useFileUrl).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:local');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('ImageBlockEditor', () => {
  it('vazio: área de soltar com envio e seletor', () => {
    setup(empty);
    expect(screen.getByText('Arraste uma imagem para cá')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar imagem' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher dos arquivos' })).toBeInTheDocument();
  });

  it('formato inválido mostra erro e não envia', async () => {
    setup(empty);
    const input = screen.getByLabelText('Arquivo de imagem') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    });
    expect(
      await screen.findByText('Formato não suportado. Use JPG, PNG ou WebP.'),
    ).toBeInTheDocument();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('envio grava file_id, dimensões e ratio original num passo', async () => {
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile).mockResolvedValue({ id: 5, url: 'https://signed/x' } as never);
    const { onConfigChange } = setup(empty);
    const input = screen.getByLabelText('Arquivo de imagem') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: 99 }));
    expect(onConfigChange).toHaveBeenCalledWith('i', {
      file_id: 5,
      width: 1600,
      height: 900,
      ratio: 'original',
    });
    // A prévia local é liberada depois do envio.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local'));
  });

  it('falha no envio: Tentar novamente reenvia o mesmo arquivo', async () => {
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile)
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ id: 6, url: 'https://signed/y' } as never);
    const { onConfigChange } = setup(empty);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Arquivo de imagem'), { target: { files: [file] } });
    expect(await screen.findByText('Não foi possível enviar a imagem.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadFile).mock.calls[1][0].file).toBe(file);
    expect(onConfigChange).toHaveBeenCalledWith('i', {
      file_id: 6,
      width: 1600,
      height: 900,
      ratio: 'original',
    });
  });

  it('preenchido com URL: renderiza a imagem', () => {
    vi.mocked(useFileUrl).mockReturnValue({
      data: 'blob:img',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    setup(filled);
    expect(screen.getByRole('img', { name: 'Equipe' })).toHaveAttribute('src', 'blob:img');
  });

  it('preenchido sem URL (perdido): Imagem indisponível + Trocar imagem', () => {
    vi.mocked(useFileUrl).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    setup(filled);
    expect(screen.getByText('Imagem indisponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trocar imagem' })).toBeInTheDocument();
  });

  it('soltar imagem no bloco preenchido troca a imagem num passo', async () => {
    vi.mocked(useFileUrl).mockReturnValue(loaded());
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile).mockResolvedValue({ id: 8, url: 'https://signed/z' } as never);
    const { onConfigChange } = setup(filled);
    const frame = screen.getByTestId('image-frame');
    const file = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    fireEvent.dragOver(frame, { dataTransfer: { types: ['Files'], files: [] } });
    expect(frame).toHaveClass('is-over');
    fireEvent.drop(frame, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadFile).mock.calls[0][0].file).toBe(file);
    expect(onConfigChange).toHaveBeenCalledWith('i', {
      file_id: 8,
      width: 1600,
      height: 900,
      ratio: 'original',
    });
  });

  it('Imagem indisponível também aceita soltar uma imagem', async () => {
    vi.mocked(useFileUrl).mockReturnValue({ ...loaded(), data: null } as never);
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile).mockResolvedValue({ id: 9, url: 'https://signed/w' } as never);
    const { onConfigChange } = setup(filled);
    const zone = screen.getByText('Imagem indisponível').closest('.rb-img-drop')!;
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveClass('is-over');
    fireEvent.drop(zone, {
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'c.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(onConfigChange.mock.calls[0][1]).toMatchObject({ file_id: 9 });
  });

  it('arrasto sem arquivo sobre o bloco preenchido não destaca nem envia', () => {
    vi.mocked(useFileUrl).mockReturnValue(loaded());
    setup(filled);
    const frame = screen.getByTestId('image-frame');
    fireEvent.dragOver(frame, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(frame).not.toHaveClass('is-over');
    fireEvent.drop(frame, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('dragleave para um filho da área não apaga o destaque', () => {
    setup(empty);
    const zone = screen.getByText('Arraste uma imagem para cá').closest('.rb-img-drop')!;
    const child = screen.getByRole('button', { name: 'Enviar imagem' });
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveClass('is-over');
    // jsdom não tem DragEvent; MouseEvent carrega relatedTarget até o React.
    fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget: child }));
    expect(zone).toHaveClass('is-over');
    fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
    expect(zone).not.toHaveClass('is-over');
  });

  it('troca que falha num bloco preenchido: Cancelar volta para a imagem atual', async () => {
    vi.mocked(useFileUrl).mockReturnValue(loaded());
    vi.mocked(getClientReportsFolderId).mockResolvedValue(99);
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('rede'));
    const { onConfigChange } = setup(filled);
    fireEvent.drop(screen.getByTestId('image-frame'), {
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'b.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('Não foi possível enviar a imagem.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Equipe' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('img', { name: 'Equipe' })).toHaveAttribute('src', 'blob:img');
    expect(screen.queryByText('Não foi possível enviar a imagem.')).toBeNull();
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('formato inválido num bloco preenchido também oferece Cancelar', async () => {
    vi.mocked(useFileUrl).mockReturnValue(loaded());
    setup(filled);
    fireEvent.drop(screen.getByTestId('image-frame'), {
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    });
    expect(
      await screen.findByText('Formato não suportado. Use JPG, PNG ou WebP.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('img', { name: 'Equipe' })).toBeInTheDocument();
  });

  it('bloco vazio com erro não mostra Cancelar', async () => {
    setup(empty);
    fireEvent.change(screen.getByLabelText('Arquivo de imagem'), {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    });
    await screen.findByText('Formato não suportado. Use JPG, PNG ou WebP.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('modo template: espaço para imagem, sem envio', () => {
    setup(empty, { mode: 'template' });
    expect(screen.getByText('Espaço para imagem')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar imagem' })).toBeNull();
    expect(useFileUrl).toHaveBeenCalledWith(null);
  });
});
