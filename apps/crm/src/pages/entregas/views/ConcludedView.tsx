import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, FileText, Search } from 'lucide-react';
import {
  getConcludedWorkflows,
  getWorkflowEtapas,
  getWorkflowPosts,
  getClientes,
  reopenWorkflow,
  getVigentePostProcesses,
  type Workflow,
  type Cliente,
  type PostProcessWithPost,
} from '../../../store';
import { supabase } from '@/lib/supabase';
import { normalize } from '@/lib/normalizeText';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { HistoryDrawer } from '../components/HistoryDrawer';
import { usePostProcessCommands } from '../hooks/usePostProcessCommands';
import { ClienteAvatar } from '@/pages/mensagens/components/Avatars';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface ConcludedWorkflowSummary {
  workflow: Workflow;
  postCount: number;
  totalDays: number | null;
  completedAt: string | null;
}

interface ClientGroup {
  cliente: Cliente;
  workflows: ConcludedWorkflowSummary[];
  processes: PostProcessWithPost[];
}

const EMPTY_PROCESSES: PostProcessWithPost[] = [];

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function ConcludedView({
  onOpenPost,
  clientSearch = '',
}: {
  onOpenPost?: (postId: number) => void;
  /** Controlado pela caixa de busca na mesma linha dos toggles de visualização,
   * em EntregasPage -- este componente só filtra pelo valor recebido. */
  clientSearch?: string;
} = {}) {
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<{
    workflow: Workflow;
    clienteName: string;
  } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ id: number; titulo: string } | null>(null);
  const [fluxoSearch, setFluxoSearch] = useState('');
  const qc = useQueryClient();

  const commands = usePostProcessCommands({
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['concluded-workflows'] });
      qc.invalidateQueries({ queryKey: ['concluded-summaries'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
    },
  });

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  // Mesma chave/fn de useEntregasData (dedupe pelo cache): o avatar do
  // Instagram sincronizado, quando existe, é bem mais confiável do que o
  // foto_url manual do cliente (raramente preenchido).
  const clienteIds = useMemo(() => clientes.map((c) => c.id!).filter(Boolean), [clientes]);
  const { data: clienteAvatars } = useQuery({
    queryKey: ['instagram-avatars', clienteIds.join(',')],
    queryFn: async () => {
      const { data } = await supabase
        .from('instagram_accounts')
        .select('client_id, profile_picture_url')
        .in('client_id', clienteIds)
        .not('profile_picture_url', 'is', null);
      const map = new Map<number, string>();
      if (data)
        for (const row of data)
          if (row.client_id && row.profile_picture_url)
            map.set(row.client_id, row.profile_picture_url);
      return map;
    },
    enabled: clienteIds.length > 0,
  });

  const { data: concludedWorkflows = [], isLoading } = useQuery({
    queryKey: ['concluded-workflows'],
    queryFn: getConcludedWorkflows,
  });

  const { data: summaries = [], isLoading: summariesLoading } = useQuery({
    queryKey: ['concluded-summaries', concludedWorkflows.map((w) => w.id).join(',')],
    queryFn: async (): Promise<ConcludedWorkflowSummary[]> => {
      return Promise.all(
        concludedWorkflows.map(async (workflow): Promise<ConcludedWorkflowSummary> => {
          const [etapas, posts] = await Promise.all([
            getWorkflowEtapas(workflow.id!),
            getWorkflowPosts(workflow.id!),
          ]);
          const firstStart = etapas.find((e) => e.iniciado_em)?.iniciado_em;
          const concludedEtapas = etapas.filter((e) => e.concluido_em);
          const lastEnd =
            concludedEtapas.length > 0
              ? concludedEtapas[concludedEtapas.length - 1].concluido_em
              : null;
          const totalDays =
            firstStart && lastEnd
              ? Math.round(
                  (new Date(lastEnd).getTime() - new Date(firstStart).getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;
          return { workflow, postCount: posts.length, totalDays, completedAt: lastEnd ?? null };
        }),
      );
    },
    enabled: concludedWorkflows.length > 0,
  });

  // Processos individuais concluídos (spec §4.4): UMA consulta por conta, a
  // mesma chave/fn de useEntregasData (dedupe pelo cache). Nunca o padrão N+1
  // dos sumários de fluxo acima.
  const { features } = useWorkspaceLimits();
  const postProcessesEnabled = features?.feature_post_processes === true;
  const { data: vigente = EMPTY_PROCESSES, isLoading: vigenteLoading } = useQuery({
    queryKey: ['post-processes', 'vigentes'],
    queryFn: getVigentePostProcesses,
  });
  const concludedProcesses = useMemo(
    () => vigente.filter((p) => p.estado === 'concluido'),
    [vigente],
  );
  const isLoadingCombined = isLoading || vigenteLoading || summariesLoading;

  const groups: ClientGroup[] = [];
  const clientMap = new Map<
    number,
    { workflows: ConcludedWorkflowSummary[]; processes: PostProcessWithPost[] }
  >();
  const bucket = (clienteId: number) => {
    let b = clientMap.get(clienteId);
    if (!b) {
      b = { workflows: [], processes: [] };
      clientMap.set(clienteId, b);
    }
    return b;
  };
  for (const s of summaries) bucket(s.workflow.cliente_id).workflows.push(s);
  for (const p of concludedProcesses) {
    if (p.post.cliente_id != null) bucket(p.post.cliente_id).processes.push(p);
  }
  for (const [clienteId, b] of clientMap) {
    const cliente = clientes.find((c) => c.id === clienteId);
    if (cliente) groups.push({ cliente, workflows: b.workflows, processes: b.processes });
  }
  groups.sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));

  const selectedGroup = groups.find((g) => g.cliente.id === selectedClienteId) ?? null;

  const normalizedClientSearch = normalize(clientSearch.trim());
  const visibleGroups = normalizedClientSearch
    ? groups.filter((g) => normalize(g.cliente.nome).includes(normalizedClientSearch))
    : groups;

  const normalizedFluxoSearch = normalize(fluxoSearch.trim());
  const visibleWorkflows = selectedGroup
    ? normalizedFluxoSearch
      ? selectedGroup.workflows.filter((s) =>
          normalize(s.workflow.titulo).includes(normalizedFluxoSearch),
        )
      : selectedGroup.workflows
    : [];
  const visibleProcesses = selectedGroup
    ? normalizedFluxoSearch
      ? selectedGroup.processes.filter((p) =>
          normalize(p.post.titulo || '').includes(normalizedFluxoSearch),
        )
      : selectedGroup.processes
    : [];

  const handleReopenConfirm = async () => {
    if (!reopenTarget) return;
    try {
      await reopenWorkflow(reopenTarget.id);
      toast.success('Fluxo reaberto com sucesso!');
      qc.invalidateQueries({ queryKey: ['concluded-workflows'] });
      qc.invalidateQueries({ queryKey: ['concluded-summaries'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
      qc.invalidateQueries({ queryKey: ['workflow-events'] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
    } catch {
      toast.error('Erro ao reabrir fluxo.');
    }
    setReopenTarget(null);
  };

  if (isLoadingCombined) {
    return <div className="drawer-empty">Carregando...</div>;
  }

  if (summaries.length === 0 && concludedProcesses.length === 0 && !isLoadingCombined) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
        {postProcessesEnabled
          ? 'Nenhum fluxo ou post individual concluído ainda.'
          : 'Nenhum fluxo concluído ainda.'}
      </div>
    );
  }

  return (
    <>
      {visibleGroups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
          Nenhum cliente encontrado para "{clientSearch}".
        </div>
      ) : (
        <div className="concluded-client-grid animate-up">
          {visibleGroups.map((group) => (
            <div
              key={group.cliente.id}
              className="concluded-client-card"
              onClick={() => {
                setSelectedClienteId(group.cliente.id!);
                setFluxoSearch('');
              }}
            >
              <div className="concluded-client-card-top">
                <ClienteAvatar
                  nome={group.cliente.nome}
                  fotoUrl={clienteAvatars?.get(group.cliente.id!) ?? group.cliente.foto_url}
                  cliente={group.cliente}
                  size="lg"
                />
                <span className="concluded-client-card-name">{group.cliente.nome}</span>
              </div>
              <div className="concluded-client-card-stats">
                {group.workflows.length} fluxo{group.workflows.length !== 1 ? 's' : ''} concluído
                {group.workflows.length !== 1 ? 's' : ''}
                {group.processes.length > 0 &&
                  ` · ${group.processes.length} post${group.processes.length !== 1 ? 's' : ''} individua${group.processes.length !== 1 ? 'is' : 'l'}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {commands.dialogs}

      {selectedGroup && (
        <Sheet open onOpenChange={(open) => !open && setSelectedClienteId(null)}>
          <SheetContent
            className="w-full sm:max-w-[480px] overflow-y-auto"
            overlayClassName="bg-black/40"
          >
            <SheetHeader className="mb-4 pr-8">
              <div className="concluded-client-card-top">
                <ClienteAvatar
                  nome={selectedGroup.cliente.nome}
                  fotoUrl={
                    clienteAvatars?.get(selectedGroup.cliente.id!) ?? selectedGroup.cliente.foto_url
                  }
                  cliente={selectedGroup.cliente}
                  size="lg"
                />
                <SheetTitle className="text-left leading-snug">
                  {selectedGroup.cliente.nome}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                Fluxos e posts concluídos de {selectedGroup.cliente.nome}
              </SheetDescription>
            </SheetHeader>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
              <Input
                placeholder="Buscar fluxo..."
                value={fluxoSearch}
                onChange={(e) => setFluxoSearch(e.target.value)}
                className="!rounded-full !text-xs h-8 pl-8 pr-4 mb-0 w-full"
              />
            </div>

            {visibleWorkflows.length === 0 && visibleProcesses.length === 0 ? (
              <div
                style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}
              >
                Nenhum fluxo encontrado para "{fluxoSearch}".
              </div>
            ) : (
              <div className="concluded-client-workflows">
                {visibleWorkflows.map((s) => (
                  <div
                    key={s.workflow.id}
                    className="concluded-wf-row"
                    onClick={() => {
                      setSelectedWorkflow({
                        workflow: s.workflow,
                        clienteName: selectedGroup.cliente.nome,
                      });
                      setSelectedClienteId(null);
                    }}
                  >
                    <div>
                      <div className="concluded-wf-title">{s.workflow.titulo}</div>
                      <div className="concluded-wf-meta">
                        {s.postCount} post{s.postCount !== 1 ? 's' : ''}
                        {s.totalDays !== null && (
                          <>
                            {' '}
                            &bull; {s.totalDays} dia{s.totalDays !== 1 ? 's' : ''}
                          </>
                        )}
                        {s.completedAt && <> &bull; Concluído {formatDateShort(s.completedAt)}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        className="concluded-reopen-btn"
                        title="Reabrir fluxo"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReopenTarget({ id: s.workflow.id!, titulo: s.workflow.titulo });
                        }}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                    </div>
                  </div>
                ))}
                {visibleProcesses.map((p) => (
                  <div
                    key={`proc-${p.id}`}
                    className="concluded-wf-row"
                    onClick={() => {
                      onOpenPost?.(p.post_id);
                      setSelectedClienteId(null);
                    }}
                  >
                    <div>
                      <div className="concluded-wf-title">
                        {p.post.titulo || 'Post sem título'}
                        <span
                          className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
                          style={{ marginLeft: '0.5rem' }}
                        >
                          <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                          Post individual
                        </span>
                      </div>
                      <div className="concluded-wf-meta">
                        {p.template_nome ?? 'Etapas personalizadas'}
                        {p.concluido_em && <> &bull; Concluído {formatDateShort(p.concluido_em)}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        className="concluded-reopen-btn"
                        title="Reabrir processo"
                        aria-label="Reabrir processo"
                        onClick={(e) => {
                          e.stopPropagation();
                          commands.reabrir({
                            process: p,
                            post: {
                              id: p.post_id,
                              titulo: p.post.titulo,
                              status: p.post.status,
                              cliente_id: p.post.cliente_id,
                            },
                          });
                        }}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}

      {selectedWorkflow && (
        <HistoryDrawer
          workflow={selectedWorkflow.workflow}
          clienteName={selectedWorkflow.clienteName}
          onClose={() => setSelectedWorkflow(null)}
        />
      )}

      <AlertDialog
        open={!!reopenTarget}
        onOpenChange={(open) => {
          if (!open) setReopenTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reabrir fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              O fluxo "{reopenTarget?.titulo}" será reaberto e voltará para a última etapa no
              Kanban.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReopenConfirm}>Reabrir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
