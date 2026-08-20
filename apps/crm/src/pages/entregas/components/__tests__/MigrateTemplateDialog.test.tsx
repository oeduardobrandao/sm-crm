import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement — same
// stubs used by CalendarGrid.test.tsx / WorkflowCalendarView.test.tsx. Real Select renders
// with these stubs (see EquipePage.test.tsx), so the component itself is unmocked here;
// only fireEvent.click (not userEvent.click) is used for Select interactions, since
// userEvent's pointer-capture checks still fail even with the stub above.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const mockMigrate = vi.fn().mockResolvedValue(undefined);
const mockGetDefs = vi.fn();
const mockGetPosts = vi.fn();

vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return {
    ...actual,
    migrateWorkflowTemplate: (...a: unknown[]) => mockMigrate(...a),
    getPropertyDefinitions: (...a: unknown[]) => mockGetDefs(...a),
    getWorkflowPostsWithProperties: (...a: unknown[]) => mockGetPosts(...a),
  };
});

import { MigrateTemplateDialog } from '../MigrateTemplateDialog';
import type { Workflow, WorkflowTemplate, TemplatePropertyDefinition } from '../../../../store';

const workflow: Workflow = {
  id: 42,
  cliente_id: 1,
  titulo: 'Fluxo A',
  template_id: 1,
  status: 'ativo',
  etapa_atual: 0,
  recorrente: false,
  modo_prazo: 'padrao',
};

const templates: WorkflowTemplate[] = [
  {
    id: 1,
    nome: 'Template A',
    modo_prazo: 'padrao',
    etapas: [{ nome: 'Antiga', prazo_dias: 1, tipo_prazo: 'corridos' }],
  },
  {
    id: 2,
    nome: 'Template B',
    modo_prazo: 'padrao',
    etapas: [
      { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis' },
      { nome: 'Aprovação', prazo_dias: 3, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
    ],
  },
];

const defA: TemplatePropertyDefinition[] = [
  {
    id: 100,
    template_id: 1,
    name: 'Tema',
    type: 'text',
    config: {},
    portal_visible: false,
    display_order: 0,
  },
  {
    id: 101,
    template_id: 1,
    name: 'Briefing',
    type: 'text',
    config: {},
    portal_visible: false,
    display_order: 1,
  },
];
const defB: TemplatePropertyDefinition[] = [
  {
    id: 200,
    template_id: 2,
    name: 'tema',
    type: 'text',
    config: {},
    portal_visible: false,
    display_order: 0,
  },
];

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function setup() {
  mockGetDefs.mockImplementation((tid: number) => Promise.resolve(tid === 1 ? defA : defB));
  mockGetPosts.mockResolvedValue([
    { id: 7, property_values: [{ property_definition_id: 101, value: 'x' }] },
    { id: 8, property_values: [] },
  ]);
  const onMigrated = vi.fn();
  renderWithClient(
    <MigrateTemplateDialog
      workflow={workflow}
      cliente={undefined}
      templates={templates}
      onClose={vi.fn()}
      onMigrated={onMigrated}
    />,
  );
  return { onMigrated };
}

async function openDestinoSelect() {
  fireEvent.click(screen.getByRole('combobox', { name: /template de destino/i }));
}

beforeEach(() => vi.clearAllMocks());

describe('MigrateTemplateDialog', () => {
  it('não oferece o template atual como destino', async () => {
    setup();
    await openDestinoSelect();
    expect(await screen.findByRole('option', { name: 'Template B' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Template A' })).toBeNull();
  });

  it('mostra prévia: propriedade que migra e a que será perdida com contagem de posts', async () => {
    setup();
    await openDestinoSelect();
    fireEvent.click(await screen.findByRole('option', { name: 'Template B' }));
    await waitFor(() => {
      expect(screen.getByText(/Tema/)).toBeTruthy();
      expect(screen.getByText(/Briefing/)).toBeTruthy();
      expect(screen.getByText(/1 post/)).toBeTruthy(); // só o post 7 tem valor em Briefing
    });
  });

  it('duas definições de origem homônimas casando na mesma de destino viram aviso de conflito', async () => {
    mockGetDefs.mockImplementation((tid: number) =>
      Promise.resolve(
        tid === 1
          ? [
              ...defA,
              {
                id: 102,
                template_id: 1,
                name: 'tema',
                type: 'text',
                config: {},
                portal_visible: false,
                display_order: 2,
              },
            ]
          : defB,
      ),
    );
    mockGetPosts.mockResolvedValue([]);
    renderWithClient(
      <MigrateTemplateDialog
        workflow={workflow}
        cliente={undefined}
        templates={templates}
        onClose={vi.fn()}
        onMigrated={vi.fn()}
      />,
    );
    await openDestinoSelect();
    fireEvent.click(await screen.findByRole('option', { name: 'Template B' }));
    await waitFor(() => {
      expect(screen.getAllByText(/um valor por post será mantido/i).length).toBeGreaterThan(0);
    });
  });

  it('confirmar dispara a RPC com o payload certo e chama onMigrated', async () => {
    const { onMigrated } = setup();
    await openDestinoSelect();
    fireEvent.click(await screen.findByRole('option', { name: 'Template B' }));
    // etapa atual default = primeira (índice 0); confirmar
    fireEvent.click(screen.getByRole('button', { name: /migrar/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));
    await waitFor(() => {
      expect(mockMigrate).toHaveBeenCalledWith({
        workflowId: 42,
        templateId: 2,
        etapas: [
          {
            nome: 'Roteiro',
            prazo_dias: 2,
            tipo_prazo: 'uteis',
            responsavel_id: null,
            tipo: 'padrao',
            data_limite: null,
          },
          {
            nome: 'Aprovação',
            prazo_dias: 3,
            tipo_prazo: 'corridos',
            responsavel_id: null,
            tipo: 'aprovacao_cliente',
            data_limite: null,
          },
        ],
        activeOrdem: 0,
        modoPrazo: 'padrao',
        expectedTemplateId: 1,
        expectedEtapaAtual: 0,
      });
      expect(onMigrated).toHaveBeenCalled();
    });
  });
});
