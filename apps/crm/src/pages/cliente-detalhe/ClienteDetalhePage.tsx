import { useEffect, useMemo, useRef, useState } from 'react';
import { isSameDay } from 'date-fns';
import { MonthGrid } from '@/components/ui/month-grid';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Home,
  Loader2,
  Cake,
  CalendarDays,
  FolderOpen,
  ExternalLink,
  FileText,
  ReceiptText,
  Wallet,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Button } from '@/components/ui/button';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getClientes,
  getTransacoes,
  getContratos,
  formatDate,
  getInitials,
  updateCliente,
  getWorkflowsByCliente,
  getWorkflowEtapas,
  getDeadlineInfo,
  getMembros,
  hasLaterApprovalEtapa,
  revertEtapa,
  approvePostsInternally,
  sendPostsToCliente,
  duplicateWorkflow,
  getWorkflowPostsCounts,
  getWorkflowApprovedPostsCounts,
  getWorkflowClearedClientePostsCounts,
  getWorkflowRevisaoInternaCounts,
  getWorkflowAwaitingClientePostsCounts,
  getClienteEnderecos,
  addClienteEndereco,
  updateClienteEndereco,
  removeClienteEndereco,
  getClienteDatas,
  addClienteData,
  updateClienteData,
  removeClienteData,
  type Cliente,
  type ClienteEndereco,
  type ClienteData,
  type Workflow,
  type WorkflowEtapa,
  type Membro,
  type Contrato,
  type Transacao,
  getWorkflowPostsWithProperties,
  getConcludedWorkflowsByCliente,
  getWorkflowPosts,
  updateWorkflowPost,
  type WorkflowPost,
  getWorkspaceSlug,
  getHubToken,
} from '../../store';
import { HistoryDrawer } from '../entregas/components/HistoryDrawer';
import { WorkflowCard } from '../entregas/components/WorkflowCard';
import { WorkflowDrawer } from '../entregas/components/WorkflowDrawer';
import {
  EditWorkflowModal,
  ForwardConfirmDialog,
  RevertConfirmDialog,
  ClientApprovalChoiceDialog,
} from '../entregas/components/WorkflowModals';
import type { BoardCard } from '../entregas/hooks/useEntregasData';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../entregas/advanceEtapa';
import { getWorkflowCovers } from '../../services/postMedia';
import { HubTab } from './HubTab';
import { ClienteDetalheHeader } from './ClienteDetalheHeader';
import { ClienteDetalheNav } from './ClienteDetalheNav';
import { ResponsiveCardRail } from './ResponsiveCardRail';
import { ClienteFinanceEmptyState } from './ClienteFinanceEmptyState';
import { buildNavModel } from './clienteDetalheNav.model';
import { getFolderContents } from '../../services/fileService';
import { FileGrid } from '../arquivos/components/FileGrid';
import {
  getInstagramSummary,
  syncInstagramData,
  getInstagramAuthUrl,
} from '../../services/instagram';
import { sanitizeUrl } from '../../utils/security';
import { useAuth } from '../../context/AuthContext';
import { formatFinancialBRL, stripFinancialFields } from '@/lib/financialAccess';
import { useTranslation } from 'react-i18next';
import { renderInstagramOverviewCard } from '../../components/instagram/InstagramOverviewCard';
import { renderInstagramFollowerChart } from '../../components/instagram/InstagramFollowerChart';
import { renderInstagramConnectButton } from '../../components/instagram/InstagramConnectButton';
import { TikTokSection } from './TikTokSection';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { useInstagramActivationEvent } from '../../hooks/useInstagramActivationEvent';
import { LatestInstagramPosts } from '../../components/instagram/LatestInstagramPosts';
import { resolveIgError } from '../../lib/instagram-oauth-errors';
import { supabase } from '@/lib/supabase';

function StatusBadge({ status }: { status: string }) {
  const { t: tc } = useTranslation();
  const map: Record<string, string> = {
    ativo: 'badge-success',
    pausado: 'badge-warning',
    encerrado: 'badge-danger',
    vigente: 'badge-success',
    a_assinar: 'badge-warning',
    pago: 'badge-success',
    agendado: 'badge-neutral',
  };
  return (
    <span className={`badge ${map[status] ?? 'badge-neutral'}`}>
      {tc(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

interface WorkflowWithEtapas {
  workflow: Workflow;
  etapas: WorkflowEtapa[];
}

export function ClientCalendarDayButton({
  date,
  dateLocale,
  selected,
  today,
  hasEvents,
  onSelect,
  children,
}: {
  date: Date;
  dateLocale: string;
  selected: boolean;
  today: boolean;
  hasEvents: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`calendar-day ${today ? 'today' : ''} ${selected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
      type="button"
      aria-label={date.toLocaleDateString(dateLocale, { dateStyle: 'long' })}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export function ScheduledPostOpenButton({
  postTitle,
  label,
  onOpen,
}: {
  postTitle: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="scheduled-item__open"
      aria-label={`${label}: ${postTitle}`}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

export default function ClienteDetalhePage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role, canSeeFinancials } = useAuth();
  const isAgent = role === 'agent';
  const { t, i18n } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const { features } = useWorkspaceLimits();
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);
  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
  const [drawerCard, setDrawerCard] = useState<BoardCard | null>(null);
  const [editCardModal, setEditCardModal] = useState<BoardCard | null>(null);
  const [forwardTarget, setForwardTarget] = useState<BoardCard | null>(null);
  const [revertTarget, setRevertTarget] = useState<BoardCard | null>(null);
  const [approvalChoiceCard, setApprovalChoiceCard] = useState<BoardCard | null>(null);

  // The edit modal can hold a valor_mensal value in its form state. On live
  // revocation, close it rather than let the value linger on screen.
  useEffect(() => {
    if (canSeeFinancials !== true) setEditOpen(false);
  }, [canSeeFinancials]);

  // Address modal state
  const [addrModalOpen, setAddrModalOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrEditing, setAddrEditing] = useState<ClienteEndereco | null>(null);
  const [addrDeleteId, setAddrDeleteId] = useState<number | null>(null);
  const [adrTipo, setAdrTipo] = useState<'residencial' | 'comercial'>('comercial');
  const [adrLogradouro, setAdrLogradouro] = useState('');
  const [adrNumero, setAdrNumero] = useState('');
  const [adrComplemento, setAdrComplemento] = useState('');
  const [adrBairro, setAdrBairro] = useState('');
  const [adrCidade, setAdrCidade] = useState('');
  const [adrEstado, setAdrEstado] = useState('');
  const [adrCep, setAdrCep] = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  // Important dates modal state
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateEditing, setDateEditing] = useState<ClienteData | null>(null);
  const [dateDeleteId, setDateDeleteId] = useState<number | null>(null);
  const [dateTitulo, setDateTitulo] = useState('');
  const [dateData, setDateData] = useState('');
  const [igOffMetaOpen, setIgOffMetaOpen] = useState(false);

  // Form state
  const [fNome, setFNome] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fTelefone, setFTelefone] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [fValor, setFValor] = useState('');
  const [fNotion, setFNotion] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');
  const [fDiaEntrega, setFDiaEntrega] = useState('');
  const [fStatus, setFStatus] = useState<Cliente['status']>('ativo');
  const [fEspecialidade, setFEspecialidade] = useState('');
  const [fAniMes, setFAniMes] = useState(''); // '01'–'12'
  const [fAniDia, setFAniDia] = useState(''); // '01'–'31'

  const clienteId = parseInt(idParam ?? '', 10);
  useEffect(() => {
    if (isNaN(clienteId)) navigate('/clientes');
  }, [clienteId, navigate]);

  useInstagramActivationEvent(clienteId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const igError = params.get('ig_error');
    const action = resolveIgError(igError);
    if (action?.kind === 'off_meta') {
      setIgOffMetaOpen(true);
    } else if (action?.kind === 'toast') {
      if (action.level === 'info') toast.info(t(action.i18nKey));
      else toast.error(t(action.i18nKey));
    }
    if (params.get('tt_error') === '1') {
      toast.error(t('detail.ttError'));
    }
    if (igError || params.get('tt_error')) {
      params.delete('ig_error');
      params.delete('tt_error');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [t]);

  const { data: clientes, isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });
  // Both queries return raw financial rows: this page is not a financial
  // route, so the route guard never covers it. Gate the fetch on the
  // capability itself — the finance section below already only RENDERS when
  // `canSeeFinancials === true` (see the JSX further down), but that gate
  // never stopped the fetch, so the rows still landed in the shared React
  // Query cache (and devtools) for a restricted admin.
  const { data: transacoes, isLoading: loadingTx } = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
    enabled: canSeeFinancials === true,
  });
  const { data: contratos, isLoading: loadingContratos } = useQuery({
    queryKey: ['contratos'],
    queryFn: getContratos,
    enabled: canSeeFinancials === true,
  });
  const {
    data: igSummary,
    isLoading: loadingIg,
    refetch: refetchIg,
  } = useQuery({
    queryKey: ['igSummary', clienteId],
    queryFn: () => getInstagramSummary(clienteId).catch(() => null),
    enabled: !isNaN(clienteId),
  });
  const { data: clienteWorkflowsRaw, isLoading: loadingWf } = useQuery({
    queryKey: ['workflowsByCliente', clienteId],
    queryFn: () => getWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });
  const { data: enderecos, isLoading: loadingEnderecos } = useQuery({
    queryKey: ['clienteEnderecos', clienteId],
    queryFn: () => getClienteEnderecos(clienteId),
    enabled: !isNaN(clienteId),
  });
  const { data: datasImportantes, isLoading: loadingDatas } = useQuery({
    queryKey: ['clienteDatas', clienteId],
    queryFn: () => getClienteDatas(clienteId),
    enabled: !isNaN(clienteId),
  });
  const { data: membros = [] as Membro[] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });

  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });

  const { data: concludedWfs = [] } = useQuery({
    queryKey: ['concluded-by-cliente', clienteId],
    queryFn: () => getConcludedWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });

  const { data: concludedSummaries = [] } = useQuery({
    queryKey: ['concluded-summaries-cliente', concludedWfs.map((w) => w.id).join(',')],
    queryFn: async () => {
      return Promise.all(
        concludedWfs.map(async (workflow) => {
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
    enabled: concludedWfs.length > 0,
  });

  const isLoading = loadingClientes || loadingTx || loadingContratos || loadingIg || loadingWf;

  const cliente: Cliente | undefined = (clientes ?? []).find((c) => c.id === clienteId);

  const [workflowsWithEtapas, setWorkflowsWithEtapas] = useState<WorkflowWithEtapas[]>([]);
  useEffect(() => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setWorkflowsWithEtapas([]);
      return;
    }
    Promise.all(
      activeWfs.map(async (w) => ({ workflow: w, etapas: await getWorkflowEtapas(w.id!) })),
    )
      .then(setWorkflowsWithEtapas)
      .catch(() => setWorkflowsWithEtapas([]));
  }, [clienteWorkflowsRaw]);

  const activeWorkflowIds = useMemo(
    () => workflowsWithEtapas.map((w) => w.workflow.id!),
    [workflowsWithEtapas],
  );

  const { data: postsCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: approvedPostsCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-approved-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowApprovedPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: clearedClienteCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-cleared-cliente-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowClearedClientePostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: revisaoInternaCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-revisao-interna-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowRevisaoInternaCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: awaitingClienteCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-awaiting-cliente-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowAwaitingClientePostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: workflowCovers } = useQuery({
    queryKey: ['workflow-covers', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowCovers(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });

  const { data: hubTokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
    enabled: !isNaN(clienteId),
  });
  const hubToken = hubTokenData?.is_active ? hubTokenData.token : undefined;

  const boardCards: BoardCard[] = useMemo(() => {
    if (!cliente) return [];
    return workflowsWithEtapas
      .map(({ workflow, etapas }) => {
        const activeEtapa = etapas.find((e) => e.status === 'ativo');
        if (!activeEtapa) return null;
        const membro = activeEtapa.responsavel_id
          ? membros.find((m: Membro) => m.id === activeEtapa.responsavel_id)
          : undefined;
        const hubUrl =
          hubToken && workspaceSlug
            ? `${window.location.origin}/${workspaceSlug}/hub/${hubToken}`
            : undefined;
        return {
          workflow,
          etapa: activeEtapa,
          cliente,
          membro,
          deadline: getDeadlineInfo(activeEtapa),
          totalEtapas: etapas.length,
          etapaIdx: activeEtapa.ordem,
          allEtapas: etapas,
          postCovers: workflowCovers?.get(workflow.id!),
          clienteAvatarUrl: igSummary?.account?.profile_picture_url,
          hubUrl,
        } satisfies BoardCard;
      })
      .filter(Boolean) as BoardCard[];
  }, [workflowsWithEtapas, cliente, membros, workflowCovers, igSummary, hubToken, workspaceSlug]);

  // Post calendar: fetch posts with scheduled_at for all active workflows
  interface PostCalendarEvent {
    postId: number;
    postTitle: string;
    workflowId: number;
    workflowTitle: string;
    date: Date;
    tipo: WorkflowPost['tipo'];
    status: WorkflowPost['status'];
  }
  const [postCalendarEvents, setPostCalendarEvents] = useState<PostCalendarEvent[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedPostDay, setSelectedPostDay] = useState<number | null>(new Date().getDate());
  const [postUpdating, setPostUpdating] = useState<number | null>(null);

  useEffect(() => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setPostCalendarEvents([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      activeWfs.map(async (wf) => {
        const posts = await getWorkflowPostsWithProperties(wf.id!);
        return posts.map((p) => ({ ...p, _wfId: wf.id!, _wfTitle: wf.titulo }));
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const events: PostCalendarEvent[] = [];
        for (const posts of results) {
          for (const post of posts) {
            if (post.scheduled_at) {
              const m = post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/);
              const parsed = m
                ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
                : new Date(post.scheduled_at);
              if (!isNaN(parsed.getTime())) {
                events.push({
                  postId: post.id!,
                  postTitle: post.titulo || t('detail.noTitle'),
                  workflowId: post._wfId,
                  workflowTitle: post._wfTitle,
                  date: parsed,
                  tipo: post.tipo,
                  status: post.status,
                });
              }
            }
          }
        }
        setPostCalendarEvents(events);
      })
      .catch(() => {
        if (!cancelled) setPostCalendarEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clienteWorkflowsRaw]);

  const refreshPostCalendar = () => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setPostCalendarEvents([]);
      return;
    }
    Promise.all(
      activeWfs.map(async (wf) => {
        const posts = await getWorkflowPostsWithProperties(wf.id!);
        return posts.map((p) => ({ ...p, _wfId: wf.id!, _wfTitle: wf.titulo }));
      }),
    )
      .then((results) => {
        const events: PostCalendarEvent[] = [];
        for (const posts of results) {
          for (const post of posts) {
            if (post.scheduled_at) {
              const m = post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/);
              const parsed = m
                ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
                : new Date(post.scheduled_at);
              if (!isNaN(parsed.getTime())) {
                events.push({
                  postId: post.id!,
                  postTitle: post.titulo || t('detail.noTitle'),
                  workflowId: post._wfId,
                  workflowTitle: post._wfTitle,
                  date: parsed,
                  tipo: post.tipo,
                  status: post.status,
                });
              }
            }
          }
        }
        setPostCalendarEvents(events);
      })
      .catch(() => {
        toast.error(t('detail.calendarUpdateError'));
      });
  };

  const handlePostStatusUpdate = async (postId: number, newStatus: 'agendado' | 'postado') => {
    setPostUpdating(postId);
    try {
      await updateWorkflowPost(postId, { status: newStatus });
      toast.success(
        newStatus === 'agendado' ? t('detail.postScheduled') : t('detail.postMarkedPosted'),
      );
      refreshPostCalendar();
    } catch {
      toast.error(t('detail.postStatusError'));
    } finally {
      setPostUpdating(null);
    }
  };

  const igSyncAttempted = useRef(false);
  useEffect(() => {
    if (!igSummary || igSyncAttempted.current) return;
    if (!igSummary.account?.last_synced_at) {
      igSyncAttempted.current = true;
      syncInstagramData(clienteId)
        .then(() => refetchIg())
        .catch(() => refetchIg());
    }
  }, [igSummary, clienteId, refetchIg]);

  const refreshCards = () => {
    queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-revisao-interna-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-covers'] });
    queryClient.invalidateQueries({ queryKey: ['concluded-by-cliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['concluded-summaries-cliente'] });
    refreshPostCalendar();
  };

  useEffect(() => {
    if (drawerCard) {
      const updated = boardCards.find((c) => c.workflow.id === drawerCard.workflow.id);
      if (updated) setDrawerCard(updated);
      else setDrawerCard(null);
    }
    if (editCardModal) {
      const updated = boardCards.find((c) => c.workflow.id === editCardModal.workflow.id);
      if (!updated) setEditCardModal(null);
    }
  }, [boardCards]);

  const handleForwardClick = (card: BoardCard) => setForwardTarget(card);

  const handleForwardConfirm = async () => {
    const card = forwardTarget;
    setForwardTarget(null);
    if (!card) return;

    const total = postsCounts.get(card.workflow.id!) ?? 0;
    // "Cleared" (approved / scheduled / posted / publish-failed), not just
    // aprovado_cliente — a workflow whose approved posts are already scheduled
    // should advance without prompting the approval dialog.
    const cleared = clearedClienteCounts.get(card.workflow.id!) ?? 0;
    const allCleared = total > 0 && cleared === total;

    if (card.etapa.tipo === 'aprovacao_cliente' && !allCleared) {
      setApprovalChoiceCard(card);
      return;
    }

    try {
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success(t('detail.stepCompleted'));
      }
      notifyRearmOutcome(result);
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleApproveInternally = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      await approvePostsInternally(card.workflow.id!);
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success(t('detail.stepCompleted'));
      }
      notifyRearmOutcome(result);
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleSendToPortal = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success(t('detail.sentToPortal'));
      refreshCards();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  };

  const handleAdvanceWithoutApproval = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      // Literal contract of this option: post statuses are left alone, so no re-arm.
      const { workflow: updatedWf } = await completeEtapaForAdvance(
        card.workflow.id!,
        card.etapa.id!,
        { rearm: false },
      );
      if (updatedWf.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success('Etapa avançada — status dos posts mantidos.');
      }
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleRevertClick = (card: BoardCard) => setRevertTarget(card);

  const handleRevertConfirm = async () => {
    const card = revertTarget;
    setRevertTarget(null);
    if (!card) return;
    try {
      await revertEtapa(card.workflow.id!);
      refreshCards();
      toast.success(t('detail.stepReverted'));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  };

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
      toast.success(t('detail.newCycleCreated'));
    } catch {
      toast.error(t('detail.newCycleError'));
    }
    setRecurringWfId(null);
  };

  const handleEdit = () => {
    if (!cliente) return;
    setFNome(cliente.nome);
    setFEmail(cliente.email || '');
    setFTelefone(cliente.telefone || '');
    setFPlano(cliente.plano || '');
    setFValor(cliente.valor_mensal ? String(cliente.valor_mensal) : '');
    setFNotion(cliente.notion_page_url || '');
    setFDiaPag(cliente.data_pagamento ? String(cliente.data_pagamento) : '');
    setFDiaEntrega(cliente.dia_entrega ? String(cliente.dia_entrega) : '');
    setFStatus(cliente.status);
    setFEspecialidade(cliente.especialidade || '');
    const [aniMes = '', aniDia = ''] = (cliente.data_aniversario || '').split('-');
    setFAniMes(aniMes);
    setFAniDia(aniDia);
    setEditOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!fNome) {
      toast.error(t('detail.nameRequired'));
      return;
    }
    const diaPag = fDiaPag ? parseInt(fDiaPag, 10) : undefined;
    if (diaPag !== undefined && (isNaN(diaPag) || diaPag < 1 || diaPag > 31)) {
      toast.error(t('detail.paymentDayRange'));
      return;
    }
    const diaEntrega = fDiaEntrega ? parseInt(fDiaEntrega, 10) : undefined;
    if (diaEntrega !== undefined && (isNaN(diaEntrega) || diaEntrega < 1 || diaEntrega > 31)) {
      toast.error(t('detail.deliveryDayRange'));
      return;
    }
    setEditLoading(true);
    try {
      const payload = {
        nome: fNome,
        email: fEmail,
        telefone: fTelefone,
        plano: fPlano,
        valor_mensal: fValor ? Number(fValor) : undefined,
        notion_page_url: fNotion,
        data_pagamento: diaPag,
        dia_entrega: diaEntrega,
        status: fStatus,
        especialidade: fEspecialidade,
        data_aniversario: fAniMes && fAniDia ? `${fAniMes}-${fAniDia}` : null,
      };
      await updateCliente(
        clienteId,
        stripFinancialFields(payload, canSeeFinancials, ['valor_mensal']),
      );
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      setEditOpen(false);
      toast.success(t('detail.clientUpdated'));
    } catch (err: unknown) {
      toast.error(t('detail.saveError', { error: (err as Error).message }));
    } finally {
      setEditLoading(false);
    }
  };

  // Address handlers
  const resetAddrForm = () => {
    setAdrTipo('comercial');
    setAdrLogradouro('');
    setAdrNumero('');
    setAdrComplemento('');
    setAdrBairro('');
    setAdrCidade('');
    setAdrEstado('');
    setAdrCep('');
    setAddrEditing(null);
  };

  const handleOpenAddrModal = (addr?: ClienteEndereco) => {
    if (addr) {
      setAddrEditing(addr);
      setAdrTipo(addr.tipo);
      setAdrLogradouro(addr.logradouro);
      setAdrNumero(addr.numero);
      setAdrComplemento(addr.complemento || '');
      setAdrBairro(addr.bairro);
      setAdrCidade(addr.cidade);
      setAdrEstado(addr.estado);
      setAdrCep(addr.cep);
    } else {
      resetAddrForm();
    }
    setAddrModalOpen(true);
  };

  const handleCepChange = async (rawCep: string) => {
    setAdrCep(rawCep);
    const digits = rawCep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast.error(t('detail.cepNotFound'));
      } else {
        if (data.logradouro) setAdrLogradouro(data.logradouro);
        if (data.bairro) setAdrBairro(data.bairro);
        if (data.localidade) setAdrCidade(data.localidade);
        if (data.uf) setAdrEstado(data.uf);
      }
    } catch {
      // silent — user can fill manually
    } finally {
      setCepLoading(false);
    }
  };

  const handleAddrSubmit = async () => {
    if (!adrLogradouro || !adrNumero || !adrBairro || !adrCidade || !adrEstado || !adrCep) {
      toast.error(t('detail.fillRequired'));
      return;
    }
    setAddrLoading(true);
    try {
      const payload = {
        cliente_id: clienteId,
        tipo: adrTipo,
        logradouro: adrLogradouro,
        numero: adrNumero,
        complemento: adrComplemento,
        bairro: adrBairro,
        cidade: adrCidade,
        estado: adrEstado,
        cep: adrCep,
      };
      if (addrEditing?.id) {
        await updateClienteEndereco(addrEditing.id, payload);
        toast.success(t('detail.addressUpdated'));
      } else {
        await addClienteEndereco(payload);
        toast.success(t('detail.addressAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      setAddrModalOpen(false);
      resetAddrForm();
    } catch (err: unknown) {
      toast.error(t('detail.addressSaveError', { error: (err as Error).message }));
    } finally {
      setAddrLoading(false);
    }
  };

  const handleAddrDelete = async () => {
    if (!addrDeleteId) return;
    try {
      await removeClienteEndereco(addrDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      toast.success(t('detail.addressRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.addressRemoveError', { error: (err as Error).message }));
    }
    setAddrDeleteId(null);
  };

  // Important dates handlers
  const resetDateForm = () => {
    setDateTitulo('');
    setDateData('');
    setDateEditing(null);
  };

  const handleOpenDateModal = (d?: ClienteData) => {
    if (d) {
      setDateEditing(d);
      setDateTitulo(d.titulo);
      setDateData(d.data);
    } else {
      resetDateForm();
    }
    setDateModalOpen(true);
  };

  const handleDateSubmit = async () => {
    if (!dateTitulo || !dateData) {
      toast.error(t('detail.fillTitleAndDate'));
      return;
    }
    setDateLoading(true);
    try {
      if (dateEditing?.id) {
        await updateClienteData(dateEditing.id, { titulo: dateTitulo, data: dateData });
        toast.success(t('detail.dateUpdated'));
      } else {
        await addClienteData({ cliente_id: clienteId, titulo: dateTitulo, data: dateData });
        toast.success(t('detail.dateAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      setDateModalOpen(false);
      resetDateForm();
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    } finally {
      setDateLoading(false);
    }
  };

  const handleDateDelete = async () => {
    if (!dateDeleteId) return;
    try {
      await removeClienteData(dateDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      toast.success(t('detail.dateRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
    setDateDeleteId(null);
  };

  // Guard the read too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (matches
  // GlobalSearchTrigger's pattern) can still leave cached data on this hook.
  const contratosCliente: Contrato[] =
    canSeeFinancials === true ? (contratos ?? []).filter((c) => c.cliente_id === clienteId) : [];
  const transacoesCliente: Transacao[] =
    canSeeFinancials === true ? (transacoes ?? []).filter((t) => t.cliente_id === clienteId) : [];

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="card" style={{ margin: '2rem', textAlign: 'center', padding: '3rem' }}>
        <h2>{t('detail.notFound')}</h2>
        <Button onClick={() => navigate('/clientes')} style={{ marginTop: 16 }}>
          {tc('actions.back')}
        </Button>
      </div>
    );
  }

  const receitaTotal = transacoesCliente
    .filter((t) => t.tipo === 'entrada' && t.status === 'pago')
    .reduce((s, t) => s + Number(t.valor), 0);
  const pendente = transacoesCliente
    .filter((t) => t.tipo === 'entrada' && t.status === 'agendado')
    .reduce((s, t) => s + Number(t.valor), 0);

  const navModel = buildNavModel({
    isAgent,
    canSeeFinancials: canSeeFinancials === true,
    activeDeliveriesCount: boardCards.length,
    deliveryHistoryCount: concludedSummaries.length,
    igSummary,
    hubToken: hubTokenData ?? null,
    workspaceSlug: workspaceSlug ?? undefined,
    contaId: cliente.conta_id ?? null,
    featureTiktok: !!features?.feature_tiktok,
    now: Date.now(),
    handlers: {
      onConnectInstagram: async () => {
        try {
          // instagram_connect_started is captured inside getInstagramAuthUrl, which every
          // connect entry point goes through.
          const url = await getInstagramAuthUrl(clienteId);
          window.location.href = url;
        } catch (err: unknown) {
          toast.error(t('instagram.connectError', { error: (err as Error).message }));
        }
      },
      onAnalytics: () => navigate(`/analytics/${clienteId}`),
      onOpenHub: () => {
        if (!hubTokenData || !workspaceSlug) return;
        const url = `${window.location.origin}/${workspaceSlug}/hub/${hubTokenData.token}`;
        window.open(url, '_blank', 'noopener');
      },
      onEditar: handleEdit,
    },
  });

  return (
    <div className="cliente-detalhe-page">
      <ClienteDetalheHeader
        nome={cliente.nome}
        initials={getInitials(cliente.nome)}
        cor={cliente.cor}
        plano={cliente.plano}
        status={cliente.status}
        imageUrl={igSummary?.account?.profile_picture_url}
        onBack={() => navigate('/clientes')}
        onEdit={handleEdit}
      />
      <ClienteDetalheNav sections={navModel.sections} actions={navModel.actions} />

      {/* Info Card */}
      <div id="sec-info" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
          {t('detail.information')}
        </h3>
        <div className="client-info-grid">
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.email')}</span>
            <span className="client-info-value">{cliente.email || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.phone')}</span>
            <span className="client-info-value">{cliente.telefone || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.paymentDay')}</span>
            <span className="client-info-value">
              {cliente.data_pagamento ? t('detail.dayN', { day: cliente.data_pagamento }) : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.deliveryDay')}</span>
            <span className="client-info-value">
              {cliente.dia_entrega ? t('detail.dayN', { day: cliente.dia_entrega }) : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.specialty')}</span>
            <span className="client-info-value">{cliente.especialidade || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.birthday')}</span>
            <span
              className="client-info-value"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {cliente.data_aniversario
                ? (() => {
                    const [mm, dd] = cliente.data_aniversario.split('-');
                    return (
                      <>
                        <Cake className="h-4 w-4" style={{ color: 'var(--pink, #f542c8)' }} />
                        {t('detail.dayOf', {
                          day: parseInt(dd),
                          month: tc(`months.${parseInt(mm) - 1}`),
                        })}
                      </>
                    );
                  })()
                : '—'}
            </span>
          </div>
          {cliente.notion_page_url && (
            <div className="client-info-item">
              <span className="client-info-label">Notion</span>
              <span className="client-info-value">
                <a
                  href={sanitizeUrl(cliente.notion_page_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('openNotion')}
                </a>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Entregas Ativas + Post Calendar */}
      {boardCards.length > 0 && (
        <div id="sec-entregas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.activeDeliveries')}
          </h3>
          <ResponsiveCardRail className="cliente-deliveries-rail">
            {boardCards.map((card) => (
              <WorkflowCard
                key={card.workflow.id}
                card={card}
                onClick={() => setDrawerCard(card)}
                onEditClick={() => setEditCardModal(card)}
                onPostsClick={() => setDrawerCard(card)}
                onForwardClick={() => handleForwardClick(card)}
                onRevertClick={() => handleRevertClick(card)}
                onRefresh={refreshCards}
                membros={membros}
                postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                approvedPostsCount={approvedPostsCounts.get(card.workflow.id!) ?? 0}
                clearedClienteCount={clearedClienteCounts.get(card.workflow.id!) ?? 0}
                revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}
                awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
              />
            ))}
          </ResponsiveCardRail>

          {/* Post Calendar */}
          {postCalendarEvents.length > 0 &&
            (() => {
              const calYear = calendarMonth.getFullYear();
              const calMonth = calendarMonth.getMonth();
              const monthNamesLocal = Array.from({ length: 12 }, (_, i) => tc(`months.${i}`));

              const tipoColors: Record<string, string> = {
                feed: '#3b82f6',
                reels: '#8b5cf6',
                stories: '#f59e0b',
                carrossel: '#10b981',
              };
              const tipoLabels: Record<string, string> = {
                feed: t('detail.postType.feed'),
                reels: t('detail.postType.reels'),
                stories: t('detail.postType.stories'),
                carrossel: t('detail.postType.carrossel'),
              };

              const selectedEvents = selectedPostDay
                ? postCalendarEvents.filter(
                    (e) =>
                      e.date.getFullYear() === calYear &&
                      e.date.getMonth() === calMonth &&
                      e.date.getDate() === selectedPostDay,
                  )
                : [];

              return (
                <div
                  style={{
                    marginTop: '1rem',
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '1rem',
                  }}
                >
                  <div className="calendar-layout cliente-post-calendar">
                    <div className="calendar-main">
                      <MonthGrid
                        currentMonth={calendarMonth}
                        onMonthChange={(d) => {
                          setCalendarMonth(d);
                          setSelectedPostDay(null);
                        }}
                        renderCell={(date, isCurrentMonth) => {
                          if (!isCurrentMonth) return <div className="calendar-day empty" />;
                          const d = date.getDate();
                          const dayEvents = postCalendarEvents.filter((e) =>
                            isSameDay(e.date, date),
                          );
                          const hasEvents = dayEvents.length > 0;
                          const isDayToday = isSameDay(date, new Date());
                          const byTipo: Record<string, number> = {};
                          for (const ev of dayEvents) {
                            byTipo[ev.tipo] = (byTipo[ev.tipo] || 0) + 1;
                          }
                          return (
                            <ClientCalendarDayButton
                              date={date}
                              dateLocale={dateLocale}
                              selected={selectedPostDay === d}
                              today={isDayToday}
                              hasEvents={hasEvents}
                              onSelect={() => setSelectedPostDay(d)}
                            >
                              <span className="day-number">{d}</span>
                              <div className="day-events">
                                {Object.entries(byTipo).map(([tipo, count]) => (
                                  <div
                                    key={tipo}
                                    className="event-pill"
                                    style={{
                                      background: `${tipoColors[tipo]}18`,
                                      color: tipoColors[tipo],
                                      fontWeight: 600,
                                    }}
                                  >
                                    {count} {tipoLabels[tipo] || tipo}
                                  </div>
                                ))}
                              </div>
                            </ClientCalendarDayButton>
                          );
                        }}
                      />
                    </div>

                    <div className="scheduled-panel">
                      <div className="scheduled-header">
                        <h3>{t('detail.posts')}</h3>
                        <p>
                          {selectedPostDay
                            ? t('detail.dayOf', {
                                day: selectedPostDay,
                                month: `${monthNamesLocal[calMonth]}, ${calYear}`,
                              })
                            : `${monthNamesLocal[calMonth]} ${calYear}`}
                        </p>
                      </div>
                      <div className="scheduled-list">
                        {selectedEvents.length === 0 ? (
                          <div
                            style={{
                              textAlign: 'center',
                              padding: '2rem 0',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <p>
                              {selectedPostDay ? t('detail.noPostsThisDay') : t('detail.selectDay')}
                            </p>
                          </div>
                        ) : (
                          selectedEvents.map((ev, i) => (
                            <article key={i} className="scheduled-item">
                              <div className="item-top">
                                <div
                                  className="item-badge"
                                  style={{ background: tipoColors[ev.tipo] || '#6b7280' }}
                                />
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: '0.65rem',
                                    background: `${tipoColors[ev.tipo]}18`,
                                    color: tipoColors[ev.tipo],
                                  }}
                                >
                                  {(tipoLabels[ev.tipo] || ev.tipo).toUpperCase()}
                                </span>
                              </div>
                              <div className="item-title">{ev.postTitle}</div>
                              <div className="item-subtitle">{ev.workflowTitle}</div>
                              <div className="item-divider" />
                              <div className="item-meta">
                                {ev.date.toLocaleDateString(dateLocale)}
                              </div>
                              <ScheduledPostOpenButton
                                postTitle={ev.postTitle}
                                label={t('instagram.openPost')}
                                onOpen={() => {
                                  const card = boardCards.find(
                                    (candidate) => candidate.workflow.id === ev.workflowId,
                                  );
                                  if (card) setDrawerCard(card);
                                }}
                              />
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  marginTop: '0.6rem',
                                  flexWrap: 'wrap',
                                }}
                              >
                                {/* Chip 1: Aprovado (read-only) */}
                                {ev.status === 'aprovado_interno' ||
                                ev.status === 'aprovado_cliente' ||
                                ev.status === 'agendado' ||
                                ev.status === 'postado' ? (
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      background: '#dbeafe',
                                      color: '#1e40af',
                                      border: '1px solid #93c5fd44',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    ✓ {t('detail.approved')}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      background: 'var(--surface-2)',
                                      color: 'var(--text-muted)',
                                      border: '1px solid var(--border-color)',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    {t(`detail.postStatus.${ev.status}`, {
                                      defaultValue: ev.status,
                                    })}
                                  </span>
                                )}

                                {/* Separator */}
                                {(ev.status === 'aprovado_interno' ||
                                  ev.status === 'aprovado_cliente' ||
                                  ev.status === 'agendado' ||
                                  ev.status === 'postado') && (
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                    →
                                  </span>
                                )}

                                {/* Chip 2: Agendar */}
                                {(ev.status === 'aprovado_interno' ||
                                  ev.status === 'aprovado_cliente') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handlePostStatusUpdate(ev.postId, 'agendado');
                                    }}
                                    disabled={postUpdating !== null}
                                    style={{
                                      fontSize: '0.68rem',
                                      background: '#eff6ff',
                                      color: '#2563eb',
                                      border: '1px solid #3b82f6',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {postUpdating === ev.postId
                                      ? '...'
                                      : `○ ${t('detail.schedule')}`}
                                  </button>
                                )}
                                {(ev.status === 'agendado' || ev.status === 'postado') && (
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      background: '#ccfbf1',
                                      color: '#0f766e',
                                      border: '1px solid #5eead444',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    ✓ {t('detail.scheduled')}
                                  </span>
                                )}

                                {/* Separator */}
                                {(ev.status === 'agendado' || ev.status === 'postado') && (
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                    →
                                  </span>
                                )}

                                {/* Chip 3: Postado */}
                                {ev.status === 'agendado' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handlePostStatusUpdate(ev.postId, 'postado');
                                    }}
                                    disabled={postUpdating !== null}
                                    style={{
                                      fontSize: '0.68rem',
                                      background: '#f0fdf4',
                                      color: '#15803d',
                                      border: '1px solid #22c55e',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {postUpdating === ev.postId
                                      ? '...'
                                      : `○ ${t('detail.markPosted')}`}
                                  </button>
                                )}
                                {ev.status === 'postado' && (
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      background: '#dcfce7',
                                      color: '#15803d',
                                      border: '1px solid #22c55e',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      fontWeight: 700,
                                    }}
                                  >
                                    ✓ {t('detail.posted')}
                                  </span>
                                )}
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="cliente-post-calendar__legend">
                    {Object.entries(tipoColors).map(([tipo, color]) => (
                      <span key={tipo} className="cliente-post-calendar__legend-item">
                        <span
                          className="cliente-post-calendar__legend-marker"
                          style={{ background: color }}
                        />
                        {tipoLabels[tipo] || tipo}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
        </div>
      )}

      {concludedSummaries.length > 0 && (
        <div id="sec-historico" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.deliveryHistory')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {concludedSummaries.map((s) => (
              <div
                key={s.workflow.id}
                className="concluded-wf-row"
                onClick={() => setHistoryWorkflow(s.workflow)}
              >
                <div>
                  <div className="concluded-wf-title">{s.workflow.titulo}</div>
                  <div className="concluded-wf-meta">
                    {t('detail.postCount', { count: s.postCount })}
                    {s.totalDays !== null && (
                      <> &bull; {t('detail.dayCount', { count: s.totalDays })}</>
                    )}
                    {s.completedAt && (
                      <>
                        {' '}
                        &bull; {t('detail.concluded')}{' '}
                        {new Date(s.completedAt).toLocaleDateString(dateLocale, {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instagram Section — keyed so it fully remounts on client change */}
      <InstagramSection
        key={`ig-${clienteId}`}
        clienteId={clienteId}
        loadingIg={loadingIg}
        igSummary={igSummary}
        refetchIg={refetchIg}
        onNavigateAnalytics={() => navigate(`/analytics/${clienteId}`)}
      />

      {/* TikTok Section — dark behind feature_tiktok; keyed so it fully remounts on client change */}
      <TikTokSection key={`tt-${clienteId}`} clienteId={clienteId} />

      {/* Relatório Mensal Settings */}
      {!isAgent && cliente && (
        <div id="sec-relatorio" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
            Relatório Mensal
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Configure as opções de envio e análise do relatório mensal.
          </p>

          {/* Toggle: Send report email */}
          <div className="card" style={{ padding: '1.25rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
                  Enviar relatório por e-mail
                </div>
                <div
                  style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}
                >
                  Envia automaticamente o relatório mensal para o e-mail do cliente
                </div>
              </div>
              <Switch
                checked={cliente.send_report_email ?? false}
                onCheckedChange={async (checked) => {
                  try {
                    await updateCliente(clienteId, { send_report_email: checked });
                    queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
                    toast.success(
                      checked ? 'Envio por e-mail ativado' : 'Envio por e-mail desativado',
                    );
                  } catch {
                    toast.error('Erro ao atualizar configuração');
                  }
                }}
              />
            </div>
          </div>

          {/* Toggle: Include AI analysis */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
                  Incluir análise AI
                </div>
                <div
                  style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}
                >
                  Adiciona resumo e recomendações geradas por inteligência artificial
                </div>
              </div>
              <Switch
                checked={cliente.include_ai_analysis ?? true}
                onCheckedChange={async (checked) => {
                  try {
                    await updateCliente(clienteId, { include_ai_analysis: checked });
                    queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
                    toast.success(checked ? 'Análise AI ativada' : 'Análise AI desativada');
                  } catch {
                    toast.error('Erro ao atualizar configuração');
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Hub do Cliente */}
      {!isAgent && cliente && cliente.id != null && cliente.conta_id && workspaceSlug && (
        <div id="sec-hub" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
            {t('detail.clientHub')}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">{t('detail.clientHubDesc')}</p>
          <HubTab
            clienteId={cliente.id!}
            contaId={cliente.conta_id!}
            workspaceSlug={workspaceSlug}
          />
        </div>
      )}
      {isAgent && (
        <div id="sec-hub" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-3">
            {t('detail.clientHub')}
          </h3>
          <RoleRestrictionNotice
            title="Hub do Cliente"
            description="O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace."
          />
        </div>
      )}

      {/* Arquivos do Cliente */}
      {cliente && cliente.id != null && <ClienteArquivosSection clienteId={cliente.id!} />}

      {/* Important Dates Section */}
      <div id="sec-datas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <CalendarDays className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.importantDates')}
          </h3>
          <Button size="sm" onClick={() => handleOpenDateModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {tc('actions.add')}
          </Button>
        </div>

        {loadingDatas && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingDatas && (!datasImportantes || datasImportantes.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <CalendarDays className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noImportantDates')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addDateHint')}</p>
          </div>
        )}

        {!loadingDatas && datasImportantes && datasImportantes.length > 0 && (
          <ResponsiveCardRail className="cliente-dates-rail">
            {datasImportantes.map((d) => (
              <div
                key={d.id}
                className="cliente-date-card"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 6px 16px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = '';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                }}
              >
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.1rem' }}>
                    {d.titulo}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatDate(d.data)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28 }}
                    onClick={() => handleOpenDateModal(d)}
                    aria-label={`${t('detail.editDate')}: ${d.titulo}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28, color: 'var(--danger)' }}
                    onClick={() => setDateDeleteId(d.id!)}
                    aria-label={`${t('detail.removeDate')}: ${d.titulo}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </ResponsiveCardRail>
        )}
      </div>

      {/* Addresses Section */}
      <div id="sec-enderecos" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <MapPin className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.addresses')}
          </h3>
          <Button size="sm" onClick={() => handleOpenAddrModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {tc('actions.add')}
          </Button>
        </div>

        {loadingEnderecos && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingEnderecos && (!enderecos || enderecos.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <MapPin className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noAddresses')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addAddressHint')}</p>
          </div>
        )}

        {!loadingEnderecos && enderecos && enderecos.length > 0 && (
          <ResponsiveCardRail className="cliente-addresses-rail">
            {enderecos.map((addr) => (
              <div
                key={addr.id}
                className="cliente-address-card"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 6px 16px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = '';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span
                    className={`badge ${addr.tipo === 'residencial' ? 'badge-info' : 'badge-warning'}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {addr.tipo === 'residencial' ? (
                      <>
                        <Home className="h-3 w-3" /> {t('detail.residential')}
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3 w-3" /> {t('detail.commercial')}
                      </>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      style={{ width: 28, height: 28 }}
                      onClick={() => handleOpenAddrModal(addr)}
                      aria-label={`${t('detail.editAddress')}: ${addr.logradouro}, ${addr.numero}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      style={{ width: 28, height: 28, color: 'var(--danger)' }}
                      onClick={() => setAddrDeleteId(addr.id!)}
                      aria-label={`${t('detail.removeAddress')}: ${addr.logradouro}, ${addr.numero}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.15rem' }}>
                  {addr.logradouro}, {addr.numero}
                  {addr.complemento ? ` — ${addr.complemento}` : ''}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {addr.bairro} · {addr.cidade}/{addr.estado}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>CEP: {addr.cep}</p>
              </div>
            ))}
          </ResponsiveCardRail>
        )}
      </div>

      {canSeeFinancials === true && (
        <>
          {/* KPI Cards */}
          <StatCardGrid
            id="sec-financeiro"
            className="cliente-finance-kpis"
            style={{ marginBottom: '1.5rem' }}
          >
            <StatCard
              label={t('detail.monthlyValue')}
              value={formatFinancialBRL(cliente.valor_mensal, canSeeFinancials)}
              icon={Wallet}
              tone="blue"
              compactValue
            />
            <StatCard
              label={t('detail.totalReceived')}
              value={formatFinancialBRL(receitaTotal, canSeeFinancials)}
              icon={CheckCircle2}
              tone="green"
              compactValue
            />
            <StatCard
              label={t('detail.pending')}
              value={formatFinancialBRL(pendente, canSeeFinancials)}
              valueColor="var(--warning)"
              icon={Clock}
              tone="amber"
              compactValue
            />
          </StatCardGrid>

          {/* Contratos Table */}
          <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
              {t('detail.contracts')}
            </h3>
            {contratosCliente.length === 0 ? (
              <ClienteFinanceEmptyState
                icon={FileText}
                title={t('detail.noContracts')}
                description={t('detail.noContractsDescription')}
                actionLabel={t('detail.manageContracts')}
                actionHref="/contratos"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('detail.contractTitle')}</TableHead>
                    <TableHead>{t('detail.contractPeriod')}</TableHead>
                    <TableHead>{t('detail.contractValue')}</TableHead>
                    <TableHead>{t('detail.contractStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contratosCliente.map((r) => (
                    <TableRow key={r.id ?? Math.random()}>
                      <TableCell data-label={t('detail.contractTitle')}>{r.titulo}</TableCell>
                      <TableCell data-label={t('detail.contractPeriod')}>
                        {formatDate(r.data_inicio)} – {formatDate(r.data_fim)}
                      </TableCell>
                      <TableCell data-label={t('detail.contractValue')}>
                        {formatFinancialBRL(r.valor_total, canSeeFinancials)}
                      </TableCell>
                      <TableCell data-label={t('detail.contractStatus')}>
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Transações Table */}
          <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
              {t('detail.transactions')}
            </h3>
            {transacoesCliente.length === 0 ? (
              <ClienteFinanceEmptyState
                icon={ReceiptText}
                title={t('detail.noTransactions')}
                description={t('detail.noTransactionsDescription')}
                actionLabel={t('detail.viewFinancial')}
                actionHref="/financeiro"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('detail.txDescription')}</TableHead>
                    <TableHead>{t('detail.txDate')}</TableHead>
                    <TableHead>{t('detail.txValue')}</TableHead>
                    <TableHead>{t('detail.txStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transacoesCliente.map((r) => (
                    <TableRow key={r.id ?? Math.random()}>
                      <TableCell data-label={t('detail.txDescription')}>{r.descricao}</TableCell>
                      <TableCell data-label={t('detail.txDate')}>{formatDate(r.data)}</TableCell>
                      <TableCell data-label={t('detail.txValue')}>
                        <span
                          style={{
                            color: r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)',
                            fontWeight: 600,
                          }}
                        >
                          {r.tipo === 'entrada' ? '+' : '-'}
                          {formatFinancialBRL(r.valor, canSeeFinancials)}
                        </span>
                      </TableCell>
                      <TableCell data-label={t('detail.txStatus')}>
                        <StatusBadge status={r.status ?? 'pago'} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      {/* Edit Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent style={{ maxWidth: 600 }} onConfirmClose={() => setEditOpen(false)}>
          <DialogHeader>
            <DialogTitle>{t('detail.editClient')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('detail.formName')}</Label>
              <Input value={fNome} onChange={(e) => setFNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formEmail')}</Label>
              <Input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formPhone')}</Label>
              <Input value={fTelefone} onChange={(e) => setFTelefone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formPlan')}</Label>
              <Input value={fPlano} onChange={(e) => setFPlano(e.target.value)} />
            </div>
            {canSeeFinancials === true && (
              <div className="space-y-1">
                <Label>{t('detail.formMonthlyValue')}</Label>
                <Input type="number" value={fValor} onChange={(e) => setFValor(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label>{t('detail.formNotionUrl')}</Label>
              <Input value={fNotion} onChange={(e) => setFNotion(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formPaymentDay')}</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={fDiaPag}
                onChange={(e) => setFDiaPag(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formDeliveryDay')}</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={fDiaEntrega}
                onChange={(e) => setFDiaEntrega(e.target.value)}
                placeholder="1-31"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formStatus')}</Label>
              <Select value={fStatus} onValueChange={(v) => setFStatus(v as Cliente['status'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">{tc('status.ativo')}</SelectItem>
                  <SelectItem value="pausado">{tc('status.pausado')}</SelectItem>
                  <SelectItem value="encerrado">{tc('status.encerrado')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formSpecialty')}</Label>
              <Input value={fEspecialidade} onChange={(e) => setFEspecialidade(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.formBirthday')}</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Select value={fAniMes} onValueChange={setFAniMes}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('detail.monthPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      { length: 12 },
                      (_, i) =>
                        [String(i + 1).padStart(2, '0'), tc(`months.${i}`)] as [string, string],
                    ).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={fAniDia} onValueChange={setFAniDia}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('detail.dayPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(
                      (d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleEditSubmit} disabled={editLoading}>
              {editLoading && <Spinner size="sm" />} {tc('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Address Add/Edit Modal */}
      <Dialog
        open={addrModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddrModalOpen(false);
            resetAddrForm();
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 540 }}
          onConfirmClose={() => {
            setAddrModalOpen(false);
            resetAddrForm();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {addrEditing ? t('detail.editAddress') : t('detail.newAddress')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('detail.addrType')}</Label>
              <Select
                value={adrTipo}
                onValueChange={(v) => setAdrTipo(v as 'residencial' | 'comercial')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comercial">{t('detail.commercial')}</SelectItem>
                  <SelectItem value="residencial">{t('detail.residential')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrCep')}</Label>
              <div style={{ position: 'relative' }}>
                <Input
                  placeholder="00000-000"
                  value={adrCep}
                  onChange={(e) => handleCepChange(e.target.value)}
                />
                {cepLoading && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  >
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      style={{ color: 'var(--primary-color)' }}
                    />
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {t('detail.addrCepHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrStreet')}</Label>
              <Input
                placeholder={t('detail.addrStreetPlaceholder')}
                value={adrLogradouro}
                onChange={(e) => setAdrLogradouro(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
              <div className="space-y-1">
                <Label>{t('detail.addrNumber')}</Label>
                <Input
                  placeholder="123"
                  value={adrNumero}
                  onChange={(e) => setAdrNumero(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('detail.addrComplement')}</Label>
                <Input
                  placeholder={t('detail.addrComplementPlaceholder')}
                  value={adrComplemento}
                  onChange={(e) => setAdrComplemento(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrNeighborhood')}</Label>
              <Input
                placeholder={t('detail.addrNeighborhoodPlaceholder')}
                value={adrBairro}
                onChange={(e) => setAdrBairro(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
              <div className="space-y-1">
                <Label>{t('detail.addrCity')}</Label>
                <Input
                  placeholder={t('detail.addrCityPlaceholder')}
                  value={adrCidade}
                  onChange={(e) => setAdrCidade(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('detail.addrState')}</Label>
                <Input
                  placeholder={t('detail.addrStatePlaceholder')}
                  maxLength={2}
                  value={adrEstado}
                  onChange={(e) => setAdrEstado(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddrModalOpen(false);
                resetAddrForm();
              }}
            >
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleAddrSubmit} disabled={addrLoading}>
              {addrLoading && <Spinner size="sm" />}{' '}
              {addrEditing ? tc('actions.save') : tc('actions.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Instagram off-Meta activity setting blocked the OAuth connection */}
      <AlertDialog open={igOffMetaOpen} onOpenChange={setIgOffMetaOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.igOffMetaTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.igOffMetaIntro')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>{t('detail.igOffMetaStep1')}</li>
            <li>{t('detail.igOffMetaStep2')}</li>
            <li>{t('detail.igOffMetaStep3')}</li>
            <li>{t('detail.igOffMetaStep4')}</li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIgOffMetaOpen(false)}>
              {t('detail.igOffMetaOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Address Delete Confirm */}
      <AlertDialog
        open={addrDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setAddrDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeAddress')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeAddressConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddrDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Date Add/Edit Modal */}
      <Dialog
        open={dateModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDateModalOpen(false);
            resetDateForm();
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 440 }}
          onConfirmClose={() => {
            setDateModalOpen(false);
            resetDateForm();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dateEditing ? t('detail.editDate') : t('detail.newImportantDate')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('detail.dateTitle')}</Label>
              <Input
                placeholder={t('detail.dateTitlePlaceholder')}
                value={dateTitulo}
                onChange={(e) => setDateTitulo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.dateField')}</Label>
              <Input type="date" value={dateData} onChange={(e) => setDateData(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDateModalOpen(false);
                resetDateForm();
              }}
            >
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleDateSubmit} disabled={dateLoading}>
              {dateLoading && <Spinner size="sm" />}{' '}
              {dateEditing ? tc('actions.save') : tc('actions.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Delete Confirm */}
      <AlertDialog
        open={dateDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDateDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeDate')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeDateConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDateDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Recurring workflow confirm */}
      <AlertDialog
        open={recurringWfId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecurringWfId(null);
            queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.workflowCompleted')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.workflowRecurring')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setRecurringWfId(null);
                queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
              }}
            >
              {tc('actions.no')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRecurringConfirm}>
              {t('detail.createNewCycle')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {historyWorkflow && (
        <HistoryDrawer
          workflow={historyWorkflow}
          clienteName={cliente?.nome}
          onClose={() => setHistoryWorkflow(null)}
        />
      )}

      {drawerCard && (
        <WorkflowDrawer
          card={drawerCard}
          membros={membros}
          onClose={() => setDrawerCard(null)}
          onRefresh={refreshCards}
        />
      )}

      {editCardModal && (
        <EditWorkflowModal
          card={editCardModal}
          membros={membros}
          clientes={clientes ?? []}
          onClose={() => setEditCardModal(null)}
          onSaved={refreshCards}
          onDeleted={() => {
            setEditCardModal(null);
            refreshCards();
          }}
          onOpenPosts={() => {
            setDrawerCard(editCardModal);
            setEditCardModal(null);
          }}
        />
      )}

      <ForwardConfirmDialog
        open={!!forwardTarget}
        workflowTitle={forwardTarget?.workflow.titulo ?? ''}
        nextEtapaName={
          forwardTarget
            ? (forwardTarget.allEtapas.find((e) => e.ordem === forwardTarget.etapaIdx + 1)?.nome ??
              '')
            : ''
        }
        onConfirm={handleForwardConfirm}
        onCancel={() => setForwardTarget(null)}
      />
      <RevertConfirmDialog
        open={!!revertTarget}
        workflowTitle={revertTarget?.workflow.titulo ?? ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => setRevertTarget(null)}
      />
      <ClientApprovalChoiceDialog
        open={!!approvalChoiceCard}
        workflowTitle={approvalChoiceCard?.workflow.titulo ?? ''}
        willRearm={
          approvalChoiceCard
            ? hasLaterApprovalEtapa(approvalChoiceCard.allEtapas, approvalChoiceCard.etapa.id!)
            : false
        }
        onApproveInternally={handleApproveInternally}
        onSendToPortal={handleSendToPortal}
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
        onCancel={() => setApprovalChoiceCard(null)}
      />
    </div>
  );
}

function ClienteArquivosSection({ clienteId }: { clienteId: number }) {
  const { t } = useTranslation('clients');
  const navigate = useNavigate();
  const { data: folderData } = useQuery({
    queryKey: ['client-folder', clienteId],
    queryFn: async () => {
      const { supabase } = await import('../../lib/supabase');
      const { data } = await supabase
        .from('folders')
        .select('id')
        .eq('source_type', 'client')
        .eq('source_id', clienteId)
        .single();
      return data;
    },
  });

  const folderId = folderData?.id ?? null;

  const { data: contents, isLoading } = useQuery({
    queryKey: ['folder-contents', folderId],
    queryFn: () => getFolderContents(folderId),
    enabled: folderId !== null,
  });

  const files = (contents?.files ?? []).slice(0, 12);
  const subfolders = contents?.subfolders ?? [];
  const totalFiles = contents?.files?.length ?? 0;

  return (
    <div id="sec-arquivos" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
          <FolderOpen className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
          {t('detail.files')}
        </h3>
        {folderId && (
          <button
            onClick={() => navigate('/arquivos')}
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            {t('detail.viewAll')} <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : files.length === 0 && subfolders.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-4">{t('detail.noFiles')}</p>
      ) : (
        <>
          <FileGrid
            files={files}
            subfolders={subfolders}
            onOpenFolder={() => navigate('/arquivos')}
            onFileAction={() => {}}
            onActionComplete={() => {}}
            viewMode="grid"
          />
          {totalFiles > 12 && (
            <button
              onClick={() => navigate('/arquivos')}
              className="mt-3 text-sm text-[var(--primary-color)] hover:underline"
            >
              {t('detail.viewMoreFiles', { count: totalFiles - 12 })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Isolated component for imperative Instagram widgets.
// Keyed by clienteId so it fully remounts on navigation.
// Never conditionally mounts/unmounts its ref divs — React never touches their children.
export function InstagramSection({
  clienteId,
  loadingIg,
  igSummary,
  refetchIg,
  onNavigateAnalytics,
}: {
  clienteId: number;
  loadingIg: boolean;
  igSummary: any;
  refetchIg: () => void;
  onNavigateAnalytics: () => void;
}) {
  const { t, i18n } = useTranslation('clients');
  const igOverviewRef = useRef<HTMLDivElement>(null);
  const igChartRef = useRef<HTMLDivElement>(null);
  const igConnectRef = useRef<HTMLDivElement>(null);

  const [autoPublish, setAutoPublish] = useState(false);
  const [autoPublishLoading, setAutoPublishLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('clientes')
      .select('auto_publish_on_approval')
      .eq('id', clienteId)
      .single()
      .then(({ data }) => {
        if (data) setAutoPublish(data.auto_publish_on_approval);
      });
  }, [clienteId]);

  const handleAutoPublishToggle = async (checked: boolean) => {
    setAutoPublishLoading(true);
    try {
      await supabase
        .from('clientes')
        .update({ auto_publish_on_approval: checked })
        .eq('id', clienteId);
      setAutoPublish(checked);
    } catch {
      /* ignore */
    } finally {
      setAutoPublishLoading(false);
    }
  };

  useEffect(() => {
    if (loadingIg) return;
    if (!igSummary) {
      if (igConnectRef.current && !isNaN(clienteId)) {
        renderInstagramConnectButton(igConnectRef.current, clienteId);
      }
      return;
    }
    if (igSummary.account?.last_synced_at) {
      if (igOverviewRef.current)
        renderInstagramOverviewCard(igOverviewRef.current, clienteId, igSummary.account, refetchIg);
      if (igChartRef.current)
        renderInstagramFollowerChart(igChartRef.current, igSummary.history ?? []);
    }
  }, [loadingIg, igSummary, clienteId, refetchIg, i18n.language]);

  return (
    <div id="ig-container" style={{ marginBottom: '1.5rem' }}>
      {loadingIg && (
        <div className="flex justify-center p-4">
          <Spinner size="lg" />
        </div>
      )}
      {!loadingIg && igSummary && !igSummary.account?.last_synced_at && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner size="lg" />
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>{t('detail.igSyncing')}</p>
        </div>
      )}
      <div ref={igOverviewRef} />
      <div ref={igChartRef} />
      {!loadingIg && igSummary?.account?.last_synced_at && (
        <LatestInstagramPosts clienteId={clienteId} />
      )}
      {!loadingIg && igSummary?.account?.last_synced_at && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '1.5rem',
            marginBottom: '1rem',
          }}
        >
          <Button onClick={onNavigateAnalytics}>{t('detail.viewFullAnalytics')}</Button>
        </div>
      )}
      {igSummary?.account?.last_synced_at && (
        <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
                {t('detail.autoPublishTitle')}
              </div>
              <div
                style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}
              >
                {t('detail.autoPublishDesc')}
              </div>
            </div>
            <Switch
              checked={autoPublish}
              onCheckedChange={handleAutoPublishToggle}
              disabled={autoPublishLoading}
            />
          </div>
        </div>
      )}
      <div ref={igConnectRef} />
    </div>
  );
}
