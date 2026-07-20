import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  // Present so a future template-cleanup call in the catch block would be a real spy
  // rather than a TypeError swallowed by the best-effort guard. See the orphan test.
  removeWorkflowTemplate: vi.fn(),
}));
vi.mock('../../../../store', () => store);

import { createWorkflowFromWizard, type WizardCreateInput } from '../createWorkflow';
import { defaultEtapa } from '../../components/SortableEtapaList';

const baseInput = (over: Partial<WizardCreateInput> = {}): WizardCreateInput => ({
  clienteId: 1,
  titulo: 'Posts — Agosto de 2026',
  recorrente: true,
  modoPrazo: 'padrao',
  mesEntrega: '',
  etapas: [defaultEtapa({ nome: 'Criação', responsavelId: 7 })],
  source: { kind: 'preset', presetId: 'posts-mensais', presetNome: 'Posts mensais' },
  saveAsTemplate: false,
  templateName: '',
  cliente: { id: 1, dia_entrega: 5 } as never,
  membros: [{ id: 7, nome: 'Maria' }] as never,
  ...over,
});

describe('createWorkflowFromWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.addWorkflow.mockResolvedValue({ id: 42 });
    store.addWorkflowEtapa.mockResolvedValue({ id: 1 });
    store.addWorkflowTemplate.mockResolvedValue({ id: 9, nome: 'Meu template' });
  });

  it('creates template FIRST and links it via template_id', async () => {
    const result = await createWorkflowFromWizard(
      baseInput({ saveAsTemplate: true, templateName: 'Meu template' }),
    );
    expect(store.addWorkflowTemplate.mock.invocationCallOrder[0]).toBeLessThan(
      store.addWorkflow.mock.invocationCallOrder[0],
    );
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: 9 }));
    expect(result.template).toEqual({ id: 9, nome: 'Meu template' });
    expect(result.warning).toBeUndefined();
  });

  it('template failure warns but still creates the workflow with template_id null', async () => {
    store.addWorkflowTemplate.mockRejectedValue(new Error('boom'));
    const result = await createWorkflowFromWizard(
      baseInput({ saveAsTemplate: true, templateName: 'Meu template' }),
    );
    expect(result.workflow).toEqual({ id: 42 });
    expect(result.warning).toBe('O fluxo será criado, mas não foi possível salvar o template.');
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: null }));
  });

  it('account-template source links the source template id', async () => {
    await createWorkflowFromWizard(
      baseInput({ source: { kind: 'template', templateId: 5, templateNome: 'T' } }),
    );
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: 5 }));
  });

  it('etapa failure removes the orphaned workflow but keeps the template', async () => {
    store.addWorkflowEtapa.mockRejectedValue(new Error('etapa boom'));
    await expect(
      createWorkflowFromWizard(baseInput({ saveAsTemplate: true, templateName: 'X' })),
    ).rejects.toThrow('etapa boom');
    expect(store.removeWorkflow).toHaveBeenCalledWith(42);
    // The template is deliberately NOT rolled back — a saved template outliving a failed
    // fluxo is the intended trade-off, so no cleanup call may creep into the catch block.
    expect(store.removeWorkflowTemplate).not.toHaveBeenCalled();
  });

  it('first etapa starts ativo with iniciado_em, rest pendente', async () => {
    await createWorkflowFromWizard(
      baseInput({
        etapas: [
          defaultEtapa({ nome: 'A', responsavelId: 7 }),
          defaultEtapa({ nome: 'B', responsavelId: 7 }),
        ],
      }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ ordem: 0, status: 'ativo' });
    expect(calls[0].iniciado_em).toBeTruthy();
    expect(calls[1]).toMatchObject({ ordem: 1, status: 'pendente', iniciado_em: null });
  });

  it('stale responsavel is sanitized to null at insert (defense in depth)', async () => {
    await createWorkflowFromWizard(
      baseInput({ etapas: [defaultEtapa({ nome: 'A', responsavelId: 999 })] }),
    );
    expect(store.addWorkflowEtapa).toHaveBeenCalledWith(
      expect.objectContaining({ responsavel_id: null }),
    );
  });

  const dataEntregaEtapas = [
    defaultEtapa({ nome: 'Criação', responsavelId: 7 }),
    defaultEtapa({ nome: 'Aprovação', responsavelId: 7, tipo: 'aprovacao_cliente' }),
  ];

  it('data_entrega with empty mesEntrega computes real deadlines via getNextDeliveryDate', async () => {
    await createWorkflowFromWizard(
      baseInput({ modoPrazo: 'data_entrega', mesEntrega: '', etapas: dataEntregaEtapas }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    // computeDeliveryDeadlines is real: the aprovacao anchor guarantees non-null ISO dates
    expect(calls.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.data_limite))).toBe(true);
  });

  it("the Select sentinel '__auto__' is normalized and never parsed as YYYY-MM", async () => {
    await createWorkflowFromWizard(
      baseInput({ modoPrazo: 'data_entrega', mesEntrega: '__auto__', etapas: dataEntregaEtapas }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.data_limite))).toBe(true); // no Invalid Date
  });
});
