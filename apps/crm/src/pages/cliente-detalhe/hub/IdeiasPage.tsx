import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, ListChecks } from 'lucide-react';
import { getIdeias, type Ideia } from '@/store';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';
import { HubRoleGate } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

export default function IdeiasPage() {
  const { clienteId } = useOutletContext<ClienteDetalheOutletContext>();

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Ideias</h2>
          <p className="hub-page__sub">Ideias enviadas pelo cliente pelo portal.</p>
        </div>
      </header>
      <HubRoleGate>
        <IdeiasTab clienteId={clienteId} />
      </HubRoleGate>
    </div>
  );
}

type StatusFilter = 'all' | Ideia['status'];

const STATUS_ORDER: Ideia['status'][] = [
  'nova',
  'em_analise',
  'aprovada',
  'descartada',
  'convertida',
  'concluida',
];

const STATUS_LABELS: Record<Ideia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
  convertida: 'Virou tarefa',
  concluida: 'Concluída',
};

// Espelha o predicado de conversão do IdeiaDrawer (CONVERSIBLE_STATUSES + tipo ===
// 'solicitacao') só para decidir se o atalho "Virar tarefa" aparece no card -- a
// conversão em si continua acontecendo dentro do drawer, não aqui.
const CONVERSIBLE_STATUSES: Ideia['status'][] = ['nova', 'em_analise', 'aprovada'];
function canShowConvertShortcut(ideia: Ideia): boolean {
  return ideia.tipo === 'solicitacao' && CONVERSIBLE_STATUSES.includes(ideia.status);
}

function IdeiasTab({ clienteId }: { clienteId: number }) {
  const queryKey = ['hub-ideias-crm', clienteId];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias({ cliente_id: clienteId }),
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [initialAction, setInitialAction] = useState<'responder' | 'converter' | undefined>(
    undefined,
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Contagem derivada da lista já carregada -- nenhuma query nova. Uma contagem que
  // divergisse da lista abaixo dela seria pior do que não ter contagem nenhuma.
  const statusCounts = useMemo(() => {
    const counts = new Map<Ideia['status'], number>();
    for (const ideia of ideias) {
      counts.set(ideia.status, (counts.get(ideia.status) ?? 0) + 1);
    }
    return counts;
  }, [ideias]);

  const filtered =
    statusFilter === 'all' ? ideias : ideias.filter((i) => i.status === statusFilter);

  // O chip ativo pode desaparecer sob o próprio filtro (última ideia "nova" convertida,
  // por exemplo): a lista some sem nenhum chip pressionado e sem causa visível. Volta pra
  // "Todas" assim que a contagem do filtro ativo zera.
  useEffect(() => {
    if (statusFilter === 'all') return;
    if ((statusCounts.get(statusFilter) ?? 0) > 0) return;
    setStatusFilter('all');
  }, [statusFilter, statusCounts]);

  function openDrawer(ideia: Ideia, action?: 'responder' | 'converter') {
    setSelectedIdeia(ideia);
    setInitialAction(action);
  }

  function closeDrawer() {
    setSelectedIdeia(null);
    setInitialAction(undefined);
  }

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Ideias do cliente</h3>
      </div>

      <div className="hub-filter-chips mb-4" role="group" aria-label="Filtrar por status">
        <button
          type="button"
          data-testid="chip-todas"
          aria-pressed={statusFilter === 'all'}
          className="hub-filter-chip"
          onClick={() => setStatusFilter('all')}
        >
          Todas <span className="hub-filter-chip__count">{ideias.length}</span>
        </button>
        {STATUS_ORDER.filter((status) => (statusCounts.get(status) ?? 0) > 0).map((status) => (
          <button
            key={status}
            type="button"
            data-testid={`chip-${status}`}
            aria-pressed={statusFilter === status}
            className="hub-filter-chip"
            onClick={() => setStatusFilter(status)}
          >
            {STATUS_LABELS[status]}{' '}
            <span className="hub-filter-chip__count">{statusCounts.get(status)}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="hub-ideias__grid">
          {filtered.map((ideia) => (
            <div key={ideia.id} className="hub-ideia-card">
              <button
                type="button"
                onClick={() => openDrawer(ideia)}
                className="hub-ideia-card__body"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <IdeiaStatusBadge status={ideia.status} />
                      {ideia.ideia_reactions.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {ideia.ideia_reactions.length} reação(ões)
                        </span>
                      )}
                      {ideia.comentario_agencia && (
                        <span className="text-xs text-muted-foreground">com resposta</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{ideia.titulo}</p>
                    <p className="text-xs text-muted-foreground line-clamp-3 mt-0.5">
                      {ideia.descricao}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(ideia.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </button>
              {/* Atalhos para o IdeiaDrawer -- abrem o mesmo drawer que clicar no card já
                  abre, mas com `initialAction` levando direto para a resposta ou para o
                  fluxo de conversão em vez de largar o usuário no topo do drawer. */}
              <div className="hub-ideia-card__actions">
                <button
                  type="button"
                  className="hub-ideia-card__action"
                  onClick={() => openDrawer(ideia, 'responder')}
                  aria-label={`Responder a ${ideia.titulo}`}
                >
                  <MessageSquare size={13} />
                  Responder
                </button>
                {canShowConvertShortcut(ideia) && (
                  <button
                    type="button"
                    className="hub-ideia-card__action hub-ideia-card__action--primary"
                    onClick={() => openDrawer(ideia, 'converter')}
                    aria-label={`Virar tarefa: ${ideia.titulo}`}
                  >
                    <ListChecks size={13} />
                    Virar tarefa
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedIdeia &&
        (() => {
          // The drawer keeps a prop snapshot; once a conversion refetches the list, resolve
          // the fresh row so the drawer's derived-state UI (locked status, "Ver tarefa") updates
          // without the user having to close and reopen the drawer.
          const current = ideias.find((i) => i.id === selectedIdeia.id) ?? selectedIdeia;
          return (
            <IdeiaDrawer
              ideia={current}
              queryKey={queryKey}
              onClose={closeDrawer}
              initialAction={initialAction}
            />
          );
        })()}
    </section>
  );
}
