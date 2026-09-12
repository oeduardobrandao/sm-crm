import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getWorkflowTemplates: vi.fn(),
  getClientes: vi.fn(),
  applyPostProcess: vi.fn(),
}));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement --
// same stubs used by NewAvulsoDialog.test.tsx / MigrateTemplateDialog.test.tsx /
// PostProductionSection.test.tsx.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

import { ApplyProcessDialog } from '../ApplyProcessDialog';

const padrao = {
  id: 3,
  nome: 'Redes',
  modo_prazo: 'padrao',
  etapas: [
    { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao', responsavel_id: 9 },
    { nome: 'Design', prazo_dias: 3, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Aprovação', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
  ],
};
const entrega = { id: 4, nome: 'Mensal', modo_prazo: 'data_entrega', etapas: padrao.etapas };
const semAprovacao = {
  id: 5,
  nome: 'Curto',
  modo_prazo: 'data_entrega',
  etapas: padrao.etapas.slice(0, 2),
};
const vazio = { id: 6, nome: 'Vazio', modo_prazo: 'padrao', etapas: [] };

function renderDialog(over = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ApplyProcessDialog
        open
        onClose={onClose}
        post={{ id: 77, titulo: 'Post X', cliente_id: 4 }}
        membros={
          [
            { id: 9, nome: 'Ana' },
            { id: 4, nome: 'Bia' },
          ] as never
        }
        onApplied={onApplied}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { onApplied, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getWorkflowTemplates.mockResolvedValue([padrao, entrega, semAprovacao, vazio]);
  store.getClientes.mockResolvedValue([{ id: 4, nome: 'Aurora', dia_entrega: 10 }]);
  store.applyPostProcess.mockResolvedValue({
    ok: true,
    process_id: 5,
    post_id: 77,
    revisao: 1,
    steps: [],
  });
});

describe('ApplyProcessDialog', () => {
  it('modelo padrão: preview com etapas, responsável do template, prazo só na inicial; confirma com fingerprint e overrides', async () => {
    const { onApplied } = renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    // "Copy" também aparece no Select "Etapa inicial" (valor padrão = primeira
    // etapa) -- escopar à lista de prévia, que é o único <ul role="list">.
    const preview = await screen.findByRole('list');
    expect(within(preview).getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() => expect(store.applyPostProcess).toHaveBeenCalledTimes(1));
    const args = store.applyPostProcess.mock.calls[0][0];
    expect(args).toMatchObject({ postId: 77, templateId: 3, startOrdem: 0 });
    expect(args.templateFingerprint).toBe(
      '0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis\n2|Aprovação|aprovacao_cliente|1|corridos',
    );
    // Sem o usuário mexer no Select de responsável, a chave fica OMITIDA
    // (não o id bruto 9 do template): apply_post_process usa o próprio
    // fallback (template -> membro ainda existente -> null), evitando
    // membro_not_found quando o responsável do template já saiu da equipe
    // (achado de review, fase 4 final).
    expect(args.stepOverrides['0'].responsavel_id).toBeUndefined();
    expect(typeof args.stepOverrides['0'].prazo_efetivo).toBe('string');
    expect(args.stepOverrides['1'].prazo_efetivo).toBeNull();
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ process_id: 5 }));
    expect(toast.success).toHaveBeenCalledWith('Processo aplicado.');
  });
  it('etapa inicial no meio: anteriores marcadas como ignoradas e fora dos overrides', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Etapa inicial' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Design' }));
    expect(screen.getByText('Ignorada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() => expect(store.applyPostProcess).toHaveBeenCalled());
    expect(Object.keys(store.applyPostProcess.mock.calls[0][0].stepOverrides)).toEqual(['1', '2']);
  });
  it('data_entrega: mês pré-preenchido com a próxima entrega do cliente; sem aprovação a partir da inicial desabilita com o motivo', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Curto' }));
    expect(await screen.findByRole('combobox', { name: 'Mês de entrega' })).toHaveTextContent(
      /\d{4}/,
    );
    expect(screen.getByRole('button', { name: 'Aplicar processo' })).toBeDisabled();
    expect(
      screen.getByText(
        'O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.',
      ),
    ).toBeInTheDocument();
  });
  it('template vazio aparece desabilitado', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    expect(await screen.findByRole('option', { name: /Vazio/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
  it('template_changed: toast mapeado, templates recarregados, nada aplicado', async () => {
    store.applyPostProcess.mockRejectedValueOnce({ message: 'template_changed', code: 'P0001' });
    const { onApplied } = renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'O modelo foi alterado depois que você abriu este diálogo. Recarregue e tente de novo.',
      ),
    );
    await waitFor(() => expect(store.getWorkflowTemplates).toHaveBeenCalledTimes(2));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
