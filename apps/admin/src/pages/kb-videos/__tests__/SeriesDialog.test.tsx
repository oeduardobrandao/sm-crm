import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/api', () => ({
  upsertKbVideoSeries: vi.fn(),
  deleteKbVideoSeries: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { toast } from 'sonner';
import { upsertKbVideoSeries } from '../../../lib/api';
import { SeriesDialog } from '../SeriesDialog';

const toastError = vi.mocked(toast.error);

function renderDialog(series: Parameters<typeof SeriesDialog>[0]['series'] = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeriesDialog series={series} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastError.mockClear();
  vi.mocked(upsertKbVideoSeries).mockReset();
});

describe('SeriesDialog', () => {
  it('shows a fixed Portuguese message on a 409, never the raw server error', async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      status: 409,
    });
    vi.mocked(upsertKbVideoSeries).mockRejectedValue(err);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Primeiros passos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Já existe uma série com esse slug.'));
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('constraint'));
  });

  it('shows a fixed Portuguese message on any other error, never err.message', async () => {
    const err = Object.assign(new Error('internal server error'), { status: 500 });
    vi.mocked(upsertKbVideoSeries).mockRejectedValue(err);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Primeiros passos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Não foi possível salvar a série.'));
    expect(toastError).not.toHaveBeenCalledWith('internal server error');
  });

  it('blocks a reserved slug before submit', () => {
    renderDialog({
      id: 's1',
      title: 'Vídeo',
      slug: 'video',
      description: null,
      display_order: 0,
      status: 'draft',
      created_at: '',
      updated_at: '',
    });

    expect(screen.getByText('Slug reservado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(upsertKbVideoSeries).not.toHaveBeenCalled();
  });

  it('blocks a malformed slug before submit', () => {
    renderDialog({
      id: 's1',
      title: 'Primeiros Passos',
      slug: 'Primeiros Passos',
      description: null,
      display_order: 0,
      status: 'draft',
      created_at: '',
      updated_at: '',
    });

    expect(screen.getByText('Apenas letras minúsculas, números e hifens')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});
