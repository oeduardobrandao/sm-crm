import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../lib/api';

vi.mock('../../lib/api', () => ({ createDemoWorkspace: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { toast } from 'sonner';
import { createDemoWorkspace } from '../../lib/api';
import { CreateDemoDialog } from '../workspaces/CreateDemoDialog';

const mocked = vi.mocked(createDemoWorkspace);

function plan(id: string, name: string, extra: Partial<Plan> = {}): Plan {
  return { id, name, is_active: true, is_default: false, ...extra } as Plan;
}

const PLANS = [
  plan('free', 'Free', { is_default: true }),
  plan('pro', 'Pro'),
  plan('old', 'Antigo', { is_active: false }),
  plan('lifetime', 'Lifetime'),
  plan('scale', 'Scale'),
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/workspaces']}>
        <Routes>
          <Route
            path="/admin/workspaces"
            element={<CreateDemoDialog plans={PLANS} open onOpenChange={() => {}} />}
          />
          <Route path="/admin/workspaces/:id" element={<p>detalhe ws-9</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fill(email: string, planId = 'pro') {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Plano'), { target: { value: planId } });
}

const submit = () => screen.getByRole('button', { name: 'Criar e enviar acesso' });

describe('CreateDemoDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only active, non-default, non-internal plans', () => {
    renderDialog();
    const options = Array.from((screen.getByLabelText('Plano') as HTMLSelectElement).options).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['Selecione um plano', 'Pro', 'Scale']);
  });

  it('requires a valid e-mail and a plan', () => {
    renderDialog();
    expect(submit()).toBeDisabled();
    fill('nao-e-email', '');
    expect(submit()).toBeDisabled();
    fill('ana@x.com', '');
    expect(submit()).toBeDisabled();
    fill('ana@x.com', 'pro');
    expect(submit()).toBeEnabled();
  });

  it('disables submit while pending and sends the trimmed fields once', async () => {
    let resolve!: (v: { workspace_id: string; email: string; email_sent: boolean }) => void;
    mocked.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDialog();
    fill(' ana@x.com ');
    fireEvent.change(screen.getByLabelText('Nome (opcional)'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Código de afiliado (opcional)'), {
      target: { value: ' PARCEIRO1 ' },
    });
    fireEvent.click(submit());
    fireEvent.click(submit());
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledWith({
      email: 'ana@x.com',
      plan_id: 'pro',
      nome: 'Ana',
      ref_code: 'PARCEIRO1',
    });
    resolve({ workspace_id: 'ws-9', email: 'ana@x.com', email_sent: true });
    await screen.findByText('detalhe ws-9');
  });

  it('shows the 409/400 message inline and keeps the dialog open', async () => {
    mocked.mockRejectedValue(new Error('Já existe uma conta com este e-mail.'));
    renderDialog();
    fill('ana@x.com');
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com este e-mail.',
    );
    expect(submit()).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('on success toasts and navigates to the workspace', async () => {
    mocked.mockResolvedValue({ workspace_id: 'ws-9', email: 'ana@x.com', email_sent: true });
    renderDialog();
    fill('ana@x.com');
    fireEvent.click(submit());
    await screen.findByText('detalhe ws-9');
    expect(toast.success).toHaveBeenCalledWith(
      'Conta demo criada. O acesso foi enviado para ana@x.com.',
    );
  });

  it('warns when the e-mail was not sent', async () => {
    mocked.mockResolvedValue({ workspace_id: 'ws-9', email: 'ana@x.com', email_sent: false });
    renderDialog();
    fill('ana@x.com');
    fireEvent.click(submit());
    await screen.findByText('detalhe ws-9');
    expect(toast.message).toHaveBeenCalledWith(
      'Conta criada, mas o e-mail não foi enviado. Use Reenviar acesso.',
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe('reopening', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>abrir</button>
          <CreateDemoDialog plans={PLANS} open={open} onOpenChange={setOpen} />
        </>
      );
    }
    function renderHarness() {
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/admin/workspaces']}>
            <Routes>
              <Route path="/admin/workspaces" element={<Harness />} />
              <Route path="/admin/workspaces/:id" element={<Harness />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }
    const expectEmpty = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
      expect((await screen.findByLabelText('E-mail')) as HTMLInputElement).toHaveValue('');
      expect(screen.getByLabelText('Plano')).toHaveValue('');
      expect(screen.queryByRole('alert')).toBeNull();
    };

    it('clears fields and error after cancel', async () => {
      mocked.mockRejectedValue(new Error('Já existe uma conta com este e-mail.'));
      renderHarness();
      fill('ana@x.com');
      fireEvent.click(submit());
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByLabelText('E-mail')).toBeNull());
      await expectEmpty();
    });

    it('clears fields after a successful create', async () => {
      mocked.mockResolvedValue({ workspace_id: 'ws-9', email: 'ana@x.com', email_sent: true });
      renderHarness();
      fill('ana@x.com');
      fireEvent.click(submit());
      await waitFor(() => expect(screen.queryByLabelText('E-mail')).toBeNull());
      await expectEmpty();
    });
  });
});
