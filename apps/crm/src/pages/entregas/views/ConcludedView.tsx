import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { RotateCcw, FileText, Search } from 'lucide-react';
import {
  getConcludedWorkflows,
  getConcludedWorkflowSummaries,
  getClientes,
  reopenWorkflow,
  getVigentePostProcesses,
  type ConcludedWorkflowSummary,
  type Workflow,
  type PostProcessWithPost,
} from '../../../store';
import { normalize } from '@/lib/normalizeText';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ConcludedViewPhone, type ConcludedClientGroup } from '../phone/ConcludedViewPhone';
import { HistoryDrawer } from '../components/HistoryDrawer';
import { usePostProcessCommands } from '../hooks/usePostProcessCommands';
import { ClienteAvatar } from '@/pages/mensagens/components/Avatars';
import { Input } from '@/components/ui/input';
import { CardGridSkeleton } from '@/components/ui/skeletons';
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
import { useInstagramAvatars } from '@/hooks/useClienteAvatars';

type ClientGroup = ConcludedClientGroup;

const EMPTY_PROCESSES: PostProcessWithPost[] = [];

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'short' });
}

export function ConcludedView({
  onOpenPost,
  clientSearch = '',
  onClientSearchChange,
}: {
  onOpenPost?: (postId: number) => void;
  /** Controlado pela caixa de busca na mesma linha dos toggles de visualização,
   * em EntregasPage -- este componente só filtra pelo valor recebido. */
  clientSearch?: string;
  /** Só no celular (abaixo de 768px): a caixa de busca de cliente sai da linha dos
   * toggles e vem para dentro da vista, que devolve o texto por aqui. Sem ela, o
   * campo não aparece. */
  onClientSearchChange?: (value: string) => void;
} = {}) {
  const { t } = useTranslation('entregasViews');
  const isPhone = !useIsDesktop(768);
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

  // Mesma consulta de useEntregasData (dedupe pelo cache): o avatar do
  // Instagram sincronizado vem primeiro e o foto_url manual fica de reserva.
  const { data: clienteAvatars } = useInstagramAvatars(clientes);

  const { data: concludedWorkflows = [], isLoading } = useQuery({
    queryKey: ['concluded-workflows'],
    queryFn: getConcludedWorkflows,
  });

  const { data: summaries = [], isLoading: summariesLoading } = useQuery({
    queryKey: ['concluded-summaries', concludedWorkflows.map((w) => w.id).join(',')],
    queryFn: () => getConcludedWorkflowSummaries(concludedWorkflows),
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
      toast.success(t('concludedView.reopenSuccess'));
      qc.invalidateQueries({ queryKey: ['concluded-workflows'] });
      qc.invalidateQueries({ queryKey: ['concluded-summaries'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
      qc.invalidateQueries({ queryKey: ['workflow-events'] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
    } catch {
      toast.error(t('concludedView.reopenError'));
    }
    setReopenTarget(null);
  };

  if (isLoadingCombined) {
    return <CardGridSkeleton cards={6} />;
  }

  if (summaries.length === 0 && concludedProcesses.length === 0 && !isLoadingCombined) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
        {postProcessesEnabled ? t('concludedView.emptyWithProcesses') : t('concludedView.empty')}
      </div>
    );
  }

  if (isPhone) {
    return (
      <>
        <ConcludedViewPhone
          visibleGroups={visibleGroups}
          clientSearch={clientSearch}
          onClientSearchChange={onClientSearchChange}
          clienteAvatars={clienteAvatars}
          selectedGroup={selectedGroup}
          onSelectCliente={setSelectedClienteId}
          fluxoSearch={fluxoSearch}
          onFluxoSearchChange={setFluxoSearch}
          visibleWorkflows={visibleWorkflows}
          visibleProcesses={visibleProcesses}
          workflowOpen={selectedWorkflow !== null}
          onOpenWorkflow={(workflow, clienteName) => setSelectedWorkflow({ workflow, clienteName })}
          onCloseWorkflow={() => setSelectedWorkflow(null)}
          onOpenPost={onOpenPost}
          reopenTarget={reopenTarget}
          onReopenWorkflow={setReopenTarget}
          onReopenConfirm={handleReopenConfirm}
          onReopenCancel={() => setReopenTarget(null)}
          onReopenProcess={(p) =>
            commands.reabrir({
              process: p,
              post: {
                id: p.post_id,
                titulo: p.post.titulo,
                status: p.post.status,
                cliente_id: p.post.cliente_id,
              },
            })
          }
          formatDateShort={formatDateShort}
        />
        {commands.dialogs}
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

  return (
    <>
      {visibleGroups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
          {t('concludedView.noClientMatch', { query: clientSearch })}
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
                  fotoUrl={clienteAvatars?.get(group.cliente.id!)}
                  cliente={group.cliente}
                  size="lg"
                />
                <span className="concluded-client-card-name">{group.cliente.nome}</span>
              </div>
              <div className="concluded-client-card-stats">
                {t('concludedView.statsWorkflows', { count: group.workflows.length })}
                {group.processes.length > 0 &&
                  ` · ${t('concludedView.statsProcesses', { count: group.processes.length })}`}
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
                  fotoUrl={clienteAvatars?.get(selectedGroup.cliente.id!)}
                  cliente={selectedGroup.cliente}
                  size="lg"
                />
                <SheetTitle className="text-left leading-snug">
                  {selectedGroup.cliente.nome}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                {t('concludedView.sheetDescription', { name: selectedGroup.cliente.nome })}
              </SheetDescription>
            </SheetHeader>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
              <Input
                placeholder={t('concludedView.searchPlaceholder')}
                value={fluxoSearch}
                onChange={(e) => setFluxoSearch(e.target.value)}
                className="!rounded-full !text-xs h-8 pl-8 pr-4 mb-0 w-full"
              />
            </div>

            {visibleWorkflows.length === 0 && visibleProcesses.length === 0 ? (
              <div
                style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}
              >
                {t('concludedView.noWorkflowMatch', { query: fluxoSearch })}
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
                        {t('concludedView.postCount', { count: s.postCount })}
                        {s.totalDays !== null &&
                          ` • ${t('concludedView.dayCount', { count: s.totalDays })}`}
                        {s.completedAt &&
                          ` • ${t('concludedView.concludedOn', { date: formatDateShort(s.completedAt) })}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        className="concluded-reopen-btn"
                        title={t('concludedView.reopenWorkflow')}
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
                        {p.post.titulo || t('shared.untitledPost')}
                        <span
                          className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
                          style={{ marginLeft: '0.5rem' }}
                        >
                          <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                          {t('shared.individualPost')}
                        </span>
                      </div>
                      <div className="concluded-wf-meta">
                        {p.template_nome ?? t('shared.customStages')}
                        {p.concluido_em &&
                          ` • ${t('concludedView.concludedOn', { date: formatDateShort(p.concluido_em) })}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        className="concluded-reopen-btn"
                        title={t('concludedView.reopenProcess')}
                        aria-label={t('concludedView.reopenProcess')}
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
            <AlertDialogTitle>{t('concludedView.reopenTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('concludedView.reopenDescription', { title: reopenTarget?.titulo ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReopenConfirm}>
              {t('concludedView.reopen')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
