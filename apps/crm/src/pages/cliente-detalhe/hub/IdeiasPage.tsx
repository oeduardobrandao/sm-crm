import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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

function IdeiasTab({ clienteId }: { clienteId: number }) {
  const queryKey = ['hub-ideias-crm', clienteId];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias({ cliente_id: clienteId }),
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered =
    statusFilter === 'all' ? ideias : ideias.filter((i) => i.status === statusFilter);

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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-2 py-1 outline-none bg-background text-foreground"
        >
          <option value="all">Todos os status</option>
          <option value="nova">Nova</option>
          <option value="em_analise">Em análise</option>
          <option value="aprovada">Aprovada</option>
          <option value="descartada">Descartada</option>
          <option value="convertida">Virou tarefa</option>
          <option value="concluida">Concluída</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((ideia) => (
            <button
              key={ideia.id}
              onClick={() => setSelectedIdeia(ideia)}
              className="w-full text-left border rounded-lg p-3 hover:bg-muted/50 transition-colors"
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
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {ideia.descricao}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(ideia.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </button>
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
              onClose={() => setSelectedIdeia(null)}
            />
          );
        })()}
    </section>
  );
}
