import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubPost } from '../../../types';

const download = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/geralDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/geralDownload')>()),
  downloadGeralContent: download,
}));

import { GeralDownload } from '../GeralDownload';

const post = {
  id: 7,
  titulo: 'Vídeo',
  status: 'aprovado_cliente',
  targets: ['geral'],
  geral_caption: '',
  media: [{ id: 1, kind: 'video', mime_type: 'video/mp4', url: 'https://cdn/v.mp4' }],
} as unknown as HubPost;

describe('GeralDownload', () => {
  beforeEach(() => download.mockReset());

  it('asks for another tap when the phone could not open the share sheet', async () => {
    download.mockResolvedValueOnce('pending').mockResolvedValueOnce('shared');
    render(<GeralDownload post={post} />);
    fireEvent.click(screen.getByRole('button', { name: /baixar arquivo/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/toque de novo/i);

    fireEvent.click(screen.getByRole('button', { name: /baixar arquivo/i }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('button', { name: /baixar arquivo/i })).toBeEnabled();
    });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('shows nothing extra when the share sheet is closed', async () => {
    download.mockResolvedValueOnce('cancelled');
    render(<GeralDownload post={post} />);
    fireEvent.click(screen.getByRole('button', { name: /baixar arquivo/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /baixar arquivo/i })).toBeEnabled(),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
