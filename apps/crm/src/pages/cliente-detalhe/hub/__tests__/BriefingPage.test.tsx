import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { HubBriefingQuestionRow, BriefingRow } from '@/store/hub';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// A brief para este teste (task-4-brief.md) pedia `await userEvent.click(...)`, mas
// @testing-library/user-event NÃO está instalado neste repo (confirmado: ausente de
// package.json/package-lock.json e de node_modules/@testing-library; outros arquivos
// de teste já documentam essa mesma restrição, ex. RelatorioEditorPage.test.tsx:56).
// fireEvent.click é o padrão da casa e suficiente aqui: um chip é um <button> simples,
// não um listbox Radix que precise de pointer events reais.

// BriefingPage is a pure move of HubTab.tsx's BriefingEditor (git history at
// d30adeea), already local (its own `useQueryClient()` and queries never
// lived at the HubTab level). HubTab.test.tsx never exercised this tab
// directly, so this is new coverage — a smoke test that the route renders
// and is wired to the real store, not a full port of pre-existing assertions.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import BriefingPage from '../BriefingPage';
import * as hubStore from '@/store/hub';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE: Cliente = {
  id: 15,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  conta_id: 'ws-1',
};

/**
 * O gate do portal (HubRoleGate) lê `can('configuracoes', 'editar')`, tri-estado,
 * e nao mais o `workspaceRole` grosseiro. Derivar o `can` do papel via
 * `makeCan`/`fakeMembership` faz estes testes exercitarem a MESMA tabela-verdade
 * (`derivePermission`) que roda em producao. `null` produz 'unknown' em todos os
 * modulos, espelhando um AuthContext ainda nao resolvido.
 */
function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({
    workspaceRole,
    can: makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
  } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderPage(cliente: Cliente = CLIENTE, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<BriefingPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BRIEFING_ID = 'br-1';

type QuestionFixture = Pick<
  HubBriefingQuestionRow,
  'id' | 'question' | 'answer' | 'section' | 'display_order'
>;

/**
 * Renders BriefingPage with a single briefing already selected and its questions
 * already loaded -- seeded straight into the QueryClient's cache (not just mocked
 * as the queryFn) so the very first render already reflects the final data. That
 * matters here: the effect that defaults `selectedId` to the first briefing, and
 * the derived filter/section computations, must already show their settled values
 * by the time `render()` returns, since the brief's own test cases assert on them
 * with a plain `screen.getByTestId(...)` (no `await`/`findBy`).
 */
function renderBriefing(questions: QuestionFixture[]) {
  const briefing: BriefingRow = {
    id: BRIEFING_ID,
    cliente_id: CLIENTE.id!,
    conta_id: CLIENTE.conta_id!,
    title: 'Briefing principal',
    display_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const fullQuestions: HubBriefingQuestionRow[] = questions.map((q) => ({
    ...q,
    cliente_id: CLIENTE.id!,
    conta_id: CLIENTE.conta_id!,
    briefing_id: BRIEFING_ID,
    created_at: '2026-01-01T00:00:00.000Z',
  }));

  vi.mocked(hubStore.getBriefings).mockResolvedValue([briefing]);
  vi.mocked(hubStore.getHubBriefingQuestions).mockResolvedValue(fullQuestions);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['briefings', CLIENTE.id], [briefing]);
  queryClient.setQueryData(['hub-briefing-questions', CLIENTE.id], fullQuestions);

  return renderPage(CLIENTE, queryClient);
}

describe('BriefingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
    vi.mocked(hubStore.getBriefings).mockResolvedValue([]);
    vi.mocked(hubStore.getHubBriefingQuestions).mockResolvedValue([]);
    vi.mocked(hubStore.getBriefingTemplates).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page header and the briefing editor for an owner', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefing' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Briefings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Novo briefing/ })).toBeInTheDocument();
  });

  it('renders the RoleRestrictionNotice (not the editor) for an agent', async () => {
    setAuth('agent');
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Briefings' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
  });

  describe('filtro e progresso', () => {
    const QUESTIONS: QuestionFixture[] = [
      { id: 'a', question: 'P1', answer: 'R1', section: 'Negócio', display_order: 0 },
      { id: 'b', question: 'P2', answer: null, section: 'Negócio', display_order: 1 },
      { id: 'c', question: 'P3', answer: '', section: 'Público', display_order: 0 },
    ];

    it('conta respondidas tratando string vazia como não respondida', () => {
      renderBriefing(QUESTIONS);
      expect(screen.getByTestId('chip-todas')).toHaveTextContent('3');
      expect(screen.getByTestId('chip-sem-resposta')).toHaveTextContent('2');
      expect(screen.getByTestId('chip-respondidas')).toHaveTextContent('1');
    });

    it('filtra para as não respondidas ao clicar no chip', () => {
      renderBriefing(QUESTIONS);
      fireEvent.click(screen.getByTestId('chip-sem-resposta'));
      expect(screen.getByText('P2')).toBeInTheDocument();
      expect(screen.queryByText('P1')).not.toBeInTheDocument();
    });

    it('mostra progresso por seção no rail', () => {
      renderBriefing(QUESTIONS);
      expect(screen.getByTestId('secao-Negócio')).toHaveTextContent('1/2');
    });
  });
});
