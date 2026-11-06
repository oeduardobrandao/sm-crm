import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaBuckets, AgendaItem } from '../../todayAgenda';

const { card, getClientesMock, mutateMock, igRows } = vi.hoisted(() => ({
  igRows: [] as { client_id: number; profile_picture_url: string }[],
  card: {
    status: 'ready' as string,
    scope: 'workspace' as 'workspace' | 'mine',
    membroId: 10 as number | null,
    buckets: { atrasado: [], hoje: [], proximos: [] } as AgendaBuckets,
  },
  getClientesMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('../../../../store', () => ({ getClientes: getClientesMock }));

// The Instagram avatars query (useClienteAvatars): from().select().in().not().
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ in: () => ({ not: () => Promise.resolve({ data: igRows }) }) }),
    }),
  },
}));

// The data hook is covered by TodayCard.test / todayAgenda.test; here it only feeds buckets.
vi.mock('../../useTodayCard', () => ({
  useTodayCard: () => {
    const { t } = useTranslation('dashboard');
    return {
      t,
      ...card,
      now: new Date(2026, 7, 17, 10, 0, 0),
      complete: { mutate: mutateMock, isPending: false },
    };
  },
}));

import { InicioPrazos } from '../InicioPrazos';

const ana = { id: 10, nome: 'Ana Souza' };
const caio = { id: 11, nome: 'Caio Dias' };

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: over.key ?? String(Math.random()),
    kind: 'etapa',
    bucket: 'atrasado',
    title: 'Design',
    context: '',
    when: new Date(2026, 7, 14),
    href: '/entregas',
    responsavel: ana,
    cliente: null,
    badge: { label: '3 dias de atraso', className: 'deadline-overdue' },
    ...over,
  };
}

function renderPrazos(onlyMine = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InicioPrazos onlyMine={onlyMine} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const groupNames = () =>
  Array.from(document.querySelectorAll('.inicio-prazos__group-name')).map((e) => e.textContent);

describe('InicioPrazos', () => {
  beforeEach(() => {
    igRows.length = 0;
    getClientesMock.mockResolvedValue([
      { id: 1, nome: 'Clínica Vida', sigla: 'CV', cor: '#0f766e' },
    ]);
    card.status = 'ready';
    card.scope = 'workspace';
    card.membroId = 10;
    card.buckets = {
      atrasado: [
        item({
          key: 'a1',
          title: 'Copy',
          context: 'Pack · Clínica Vida',
          cliente: { id: 1, nome: 'Clínica Vida' },
        }),
        item({
          key: 'a2',
          title: 'Design',
          cliente: { id: 1, nome: 'Clínica Vida' },
          when: new Date(2026, 7, 10),
        }),
        item({
          key: 'a3',
          title: 'Revisar',
          cliente: { id: 2, nome: 'Studio Leve' },
          responsavel: caio,
        }),
      ],
      hoje: [
        item({
          key: 'h1',
          bucket: 'hoje',
          kind: 'tarefa',
          title: 'Ligar',
          when: null,
          tarefaId: 5,
        }),
      ],
      proximos: [
        item({
          key: 'p1',
          bucket: 'proximos',
          when: new Date(2026, 7, 19),
          cliente: { id: 1, nome: 'Clínica Vida' },
        }),
        item({
          key: 'p2',
          bucket: 'proximos',
          when: new Date(2026, 7, 19),
          cliente: { id: 2, nome: 'Studio Leve' },
        }),
      ],
    };
  });

  it('shows three bucket tiles with counts and opens on the overdue bucket grouped by client', () => {
    renderPrazos();

    const tiles = screen.getAllByRole('button', { pressed: true });
    expect(tiles[0]).toHaveTextContent('Atrasados3');
    expect(screen.getByRole('button', { name: /Hoje/ })).toHaveTextContent('1 tarefa');
    expect(groupNames()).toEqual(['Clínica Vida', 'Studio Leve']);
    expect(screen.getByText('O mais antigo venceu há 7 dias')).toBeInTheDocument();
  });

  it("shows each client's photo on its group, the initials only without one", async () => {
    getClientesMock.mockResolvedValue([
      { id: 1, nome: 'Clínica Vida', sigla: 'CV', cor: '#0f766e', foto_url: null },
      { id: 2, nome: 'Studio Leve', sigla: 'SL', cor: '#7c3aed', foto_url: null },
    ]);
    igRows.push({ client_id: 1, profile_picture_url: 'https://cdn.test/cv.jpg' });
    renderPrazos();

    const leads = () => Array.from(document.querySelectorAll('.inicio-prazos__lead'));
    await waitFor(() =>
      expect(leads()[0].querySelector('img')).toHaveAttribute('src', 'https://cdn.test/cv.jpg'),
    );
    expect(leads()[1].querySelector('img')).toBeNull();
    expect(leads()[1]).toHaveTextContent('SL');

    // An expired Instagram link falls back to the initials.
    fireEvent.error(leads()[0].querySelector('img')!);
    expect(leads()[0]).toHaveTextContent('CV');
  });

  it('opens the first group and drops the client name from its rows', () => {
    renderPrazos();

    const [first, second] = document.querySelectorAll('.inicio-prazos__group');
    expect(
      within(first as HTMLElement).getByRole('button', { expanded: true }),
    ).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('Pack')).toBeInTheDocument();
    expect(within(second as HTMLElement).queryByText('Revisar')).not.toBeInTheDocument();

    fireEvent.click(within(second as HTMLElement).getByRole('button', { expanded: false }));
    expect(within(second as HTMLElement).getByText('Revisar')).toBeInTheDocument();
    expect(within(first as HTMLElement).queryByText('Copy')).not.toBeInTheDocument();
  });

  it('InicioPrazos shows the photos of the people in a group', () => {
    card.buckets = {
      ...card.buckets,
      atrasado: [
        item({
          key: 'a1',
          cliente: { id: 1, nome: 'Clínica Vida' },
          responsavel: { ...ana, avatar_url: 'https://x.test/a.jpg' },
        }),
        item({
          key: 'a2',
          cliente: { id: 1, nome: 'Clínica Vida' },
          responsavel: { ...caio, avatar_url: null },
        }),
      ],
    };
    renderPrazos();

    const people = document.querySelectorAll<HTMLElement>('.inicio-prazos__person');
    expect(people).toHaveLength(2);
    expect(people[0].tagName).toBe('IMG');
    expect(people[0]).toHaveAttribute('src', 'https://x.test/a.jpg');
    expect(people[1]).toHaveTextContent('CD');
    // Siblings, not wrapped: the vidro overlap keys off :first-child.
    expect(people[0].parentElement).toBe(people[1].parentElement);
  });

  it('regroups by responsible and switches buckets from the tiles', () => {
    renderPrazos();

    fireEvent.click(screen.getByRole('button', { name: 'Responsável' }));
    expect(groupNames()).toEqual(['Ana Souza', 'Caio Dias']);

    fireEvent.click(screen.getByRole('button', { name: /Próximos 7 dias/ }));
    expect(screen.getByRole('heading', { name: 'Próximos 7 dias' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dia', pressed: true })).toBeInTheDocument();
    expect(groupNames()).toEqual(['Quarta-feira, 19 de agosto']);
  });

  it('completes a tarefa from its row', () => {
    renderPrazos();
    fireEvent.click(screen.getByRole('button', { name: /Hoje/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir tarefa' }));
    expect(mutateMock).toHaveBeenCalledWith({ id: 5, previousStatus: 'pendente' });
  });

  it('narrows to the signed-in member under "Só meus"', () => {
    renderPrazos(true);
    expect(screen.getAllByRole('button', { pressed: true })[0]).toHaveTextContent('Atrasados2');
    expect(groupNames()).toEqual(['Clínica Vida']);
  });

  it('explains an empty "Só meus" when the user has no linked member', () => {
    card.membroId = null;
    renderPrazos(true);
    expect(screen.getByText(/não está vinculado a um membro/)).toBeInTheDocument();
  });

  it('offers no responsible grouping to agents', () => {
    card.scope = 'mine';
    renderPrazos();
    expect(screen.queryByRole('button', { name: 'Responsável' })).not.toBeInTheDocument();
  });
});
