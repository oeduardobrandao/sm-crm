import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConcludedWorkflows, getWorkflowEtapas, getWorkflowPosts, getClientes, type Workflow, type Cliente } from '../../../store';
import { HistoryDrawer } from '../components/HistoryDrawer';

interface ConcludedWorkflowSummary {
  workflow: Workflow;
  postCount: number;
  totalDays: number | null;
  completedAt: string | null;
}

interface ClientGroup {
  cliente: Cliente;
  workflows: ConcludedWorkflowSummary[];
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function ConcludedView() {
  const [expandedClients, setExpandedClients] = useState<Set<number>>(new Set());
  const [selectedWorkflow, setSelectedWorkflow] = useState<{ workflow: Workflow; clienteName: string } | null>(null);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const { data: concludedWorkflows = [], isLoading } = useQuery({
    queryKey: ['concluded-workflows'],
    queryFn: getConcludedWorkflows,
  });

  const { data: summaries = [] } = useQuery({
    queryKey: ['concluded-summaries', concludedWorkflows.map(w => w.id).join(',')],
    queryFn: async (): Promise<ConcludedWorkflowSummary[]> => {
      return Promise.all(concludedWorkflows.map(async (workflow): Promise<ConcludedWorkflowSummary> => {
        const [etapas, posts] = await Promise.all([
          getWorkflowEtapas(workflow.id!),
          getWorkflowPosts(workflow.id!),
        ]);
        const firstStart = etapas.find(e => e.iniciado_em)?.iniciado_em;
        const concludedEtapas = etapas.filter(e => e.concluido_em);
        const lastEnd = concludedEtapas.length > 0 ? concludedEtapas[concludedEtapas.length - 1].concluido_em : null;
        const totalDays = firstStart && lastEnd
          ? Math.round((new Date(lastEnd).getTime() - new Date(firstStart).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return { workflow, postCount: posts.length, totalDays, completedAt: lastEnd ?? null };
      }));
    },
    enabled: concludedWorkflows.length > 0,
  });

  const groups: ClientGroup[] = [];
  const clientMap = new Map<number, ConcludedWorkflowSummary[]>();
  for (const s of summaries) {
    const list = clientMap.get(s.workflow.cliente_id) ?? [];
    list.push(s);
    clientMap.set(s.workflow.cliente_id, list);
  }
  for (const [clienteId, workflows] of clientMap) {
    const cliente = clientes.find(c => c.id === clienteId);
    if (cliente) groups.push({ cliente, workflows });
  }
  groups.sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));

  const toggleClient = (id: number) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return <div className="drawer-empty">Carregando...</div>;
  }

  if (summaries.length === 0 && !isLoading) {
    return <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>Nenhum fluxo concluído ainda.</div>;
  }

  return (
    <>
      <div className="animate-up">
        {groups.map(group => {
          const isOpen = expandedClients.has(group.cliente.id!);
          return (
            <div key={group.cliente.id} className="concluded-client-group">
              <div className="concluded-client-header" onClick={() => toggleClient(group.cliente.id!)}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                <div className="concluded-client-dot" style={{ background: group.cliente.cor || '#888' }} />
                <span className="concluded-client-name">{group.cliente.nome}</span>
                <span className="concluded-client-count">({group.workflows.length} fluxo{group.workflows.length > 1 ? 's' : ''})</span>
              </div>
              {isOpen && (
                <div className="concluded-client-workflows">
                  {group.workflows.map(s => (
                    <div
                      key={s.workflow.id}
                      className="concluded-wf-row"
                      onClick={() => setSelectedWorkflow({ workflow: s.workflow, clienteName: group.cliente.nome })}
                    >
                      <div>
                        <div className="concluded-wf-title">{s.workflow.titulo}</div>
                        <div className="concluded-wf-meta">
                          {s.postCount} post{s.postCount !== 1 ? 's' : ''}
                          {s.totalDays !== null && <> &bull; {s.totalDays} dia{s.totalDays !== 1 ? 's' : ''}</>}
                          {s.completedAt && <> &bull; Concluído {formatDateShort(s.completedAt)}</>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedWorkflow && (
        <HistoryDrawer
          workflow={selectedWorkflow.workflow}
          clienteName={selectedWorkflow.clienteName}
          onClose={() => setSelectedWorkflow(null)}
        />
      )}
    </>
  );
}
