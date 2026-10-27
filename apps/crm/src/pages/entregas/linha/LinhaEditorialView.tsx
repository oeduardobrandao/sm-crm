import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { QueryErrorCard } from '@/components/QueryErrorCard';
import { useClienteAvatars } from '@/hooks/useClienteAvatars';
import { captureEvent } from '@/lib/analytics';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';
import { compactHubToken } from '@/lib/hubLinks';
import { buildUsableTokenMap } from '@/lib/hubTokenMap';
import type { Cliente, Workflow } from '@/store';
import { getHubToken, getWorkspaceSlug } from '@/store/hub';
import {
  criarLinha,
  enviarLinha,
  linhaPostsKey,
  recolherLinha,
  type LinhaItem,
} from '@/store/linhaEditorial';
import { getMembros } from '@/store/team';
import { getWorkflowTemplates } from '@/store/workflows';
import type { ContentFormat } from '@mesaas/platforms';
import { loadLinhaDirecaoOculta, persistLinhaDirecaoOculta } from '../entregasPrefs';
import { NewWorkflowWizard } from '../wizard/NewWorkflowWizard';
import { converterParaFluxo } from './criarFluxoDaLinha';
import { ColunasPopover } from './ColunasPopover';
import { CriarPostsDialog } from './CriarPostsDialog';
import { LinhaClientRail } from './LinhaClientRail';
import { LinhaComentariosPanel } from './LinhaComentariosPanel';
import { LinhaHeader } from './LinhaHeader';
import { LinhaPhoneView } from './LinhaPhoneView';
import { LinhaSelectionBar } from './LinhaSelectionBar';
import { LinhaTable } from './LinhaTable';
import { formatBreakdown, mesLabel, nomeFluxoPadrao, periodoFromMes } from './linhaLogic';
import { useIsLinhaPhone } from './useIsLinhaPhone';
import { linhaItensKey, linhasKey, useLinhaQueries } from './useLinhaQueries';
import './linha.css';

export interface LinhaEditorialViewProps {
  contaId: string;
  /** Every active client the board already loads (the rail's list). */
  clientes: Cliente[];
  /** `filters.filterClientes`: in this view only the first value is the selected client. */
  filterClientes: number[];
  /** Month being edited, `YYYY-MM`. */
  mes: string;
  /** Writes the selected client and/or month back to the page (and so to the URL). */
  onChange: (q: { clientes?: number[]; mes?: string }) => void;
  /** "Ver posts" after creating avulsos: the page's Lista view of the client's posts. */
  onVerPosts?: (clienteId: number) => void;
}

/** Summary-line names (spec §6.2: "Reels 6"); `TIPO_LABELS` calls reels "Vídeo vertical". */
const TIPO_RESUMO: Record<ContentFormat, string> = {
  feed: 'Imagem',
  carrossel: 'Carrossel',
  reels: 'Reels',
  stories: 'Stories',
};

function erroDeAcao(err: unknown, fallback: string): string {
  const ent = mapEntitlementError(err);
  return ent ? entitlementMessage(ent) : fallback;
}

export function LinhaEditorialView({
  contaId,
  clientes,
  filterClientes,
  mes,
  onChange,
  onVerPosts,
}: LinhaEditorialViewProps) {
  const qc = useQueryClient();
  const periodo = periodoFromMes(mes);
  const { fotosDe } = useClienteAvatars(clientes);

  const [criandoId, setCriandoId] = useState<number | null>(null);
  const [direcaoOculta, setDirecaoOculta] = useState(() => loadLinhaDirecaoOculta(contaId));
  // Selection and the comments panel belong to one linha: keyed by its id, so switching
  // client or month starts clean without an effect.
  const [selecao, setSelecao] = useState<{ linhaId: string | null; ids: string[] }>({
    linhaId: null,
    ids: [],
  });
  const [painel, setPainel] = useState<{ linhaId: string; itemId: string | null } | null>(null);
  // "Criar posts individuais": the rows are a snapshot taken on open, so the dialog keeps
  // its count while the selection clears behind it.
  const [criarPosts, setCriarPosts] = useState<{ open: boolean; itens: LinhaItem[] }>({
    open: false,
    itens: [],
  });
  // Rows being turned into a fluxo (Task 11); non-null while the wizard is open.
  const [fluxoItens, setFluxoItens] = useState<LinhaItem[] | null>(null);

  // The selected client decides which linha the per-linha queries read, so the month's
  // linhas run first (same query key as the second call below, so it is one request).
  const base = useLinhaQueries(periodo, null);
  const linhas = useMemo(() => base.linhas.data ?? [], [base.linhas.data]);
  // Without a (valid) selection the first client of the rail is shown, without writing it
  // to the URL: linhas come first in the rail, then alphabetical.
  const selectedId = useMemo(() => {
    const wanted = filterClientes[0];
    if (wanted != null && clientes.some((c) => c.id === wanted)) return wanted;
    const comLinha = clientes
      .filter((c) => linhas.some((l) => l.cliente_id === c.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
    return (
      (comLinha[0] ?? [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))[0])?.id ??
      null
    );
  }, [filterClientes, clientes, linhas]);

  const cliente = clientes.find((c) => c.id === selectedId) ?? null;
  const linha = linhas.find((l) => l.cliente_id === selectedId) ?? null;
  const { itens, colunas, respostas } = useLinhaQueries(periodo, linha?.id ?? null);
  const itensData = useMemo(() => itens.data ?? [], [itens.data]);
  const colunasData = useMemo(() => colunas.data ?? [], [colunas.data]);
  const respostasData = useMemo(() => respostas.data ?? [], [respostas.data]);

  // Only unconverted rows of this linha that still exist count as selected.
  const selectedIds = useMemo(() => {
    if (!linha || selecao.linhaId !== linha.id) return [];
    const livres = new Set(itensData.filter((i) => i.post_id == null).map((i) => i.id));
    return selecao.ids.filter((id) => livres.has(id));
  }, [linha, selecao, itensData]);
  const painelAberto = !!linha && painel?.linhaId === linha.id;
  const painelItem =
    painelAberto && painel.itemId ? (itensData.find((i) => i.id === painel.itemId) ?? null) : null;

  const mudarDirecaoOculta = (oculta: boolean) => {
    setDirecaoOculta(oculta);
    persistLinhaDirecaoOculta(contaId, oculta);
  };

  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });
  // Own key: StandalonePostDrawer caches a plain token string under ['hub-token', id], and both
  // mount together when a converted post is opened from here.
  const { data: hubToken } = useQuery({
    queryKey: ['linha-hub-token', selectedId],
    queryFn: () => getHubToken(selectedId!),
    enabled: selectedId != null && linha?.status === 'enviada',
  });
  const hubUrl = useMemo(() => {
    if (!hubToken || !workspaceSlug || selectedId == null) return null;
    const usable = buildUsableTokenMap(
      hubToken.is_active
        ? [{ cliente_id: selectedId, token: hubToken.token, expires_at: hubToken.expires_at }]
        : [],
      new Date().toISOString(),
    ).get(selectedId);
    if (!usable) return null;
    return `${window.location.origin}/${workspaceSlug}/hub/${compactHubToken(usable)}/aprovacoes?aba=linha`;
  }, [hubToken, workspaceSlug, selectedId]);

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: linhasKey(periodo) });
    if (linha) void qc.invalidateQueries({ queryKey: linhaItensKey(linha.id) });
  };

  const criar = useMutation({
    mutationFn: (clienteId: number) => criarLinha(clienteId, periodo),
    onMutate: (clienteId) => setCriandoId(clienteId),
    onSuccess: (_id, clienteId) => {
      void qc.invalidateQueries({ queryKey: linhasKey(periodo) });
      onChange({ clientes: [clienteId] });
    },
    onError: (err) =>
      toast.error(erroDeAcao(err, 'Não foi possível criar a linha. Tente de novo.')),
    onSettled: () => setCriandoId(null),
  });

  const enviar = useMutation({
    mutationFn: (id: string) => enviarLinha(id),
    onSuccess: () => {
      invalidar();
      toast.success('Linha enviada ao cliente.');
    },
    onError: (err) =>
      toast.error(erroDeAcao(err, 'Não foi possível enviar a linha. Tente de novo.')),
  });

  const recolher = useMutation({
    mutationFn: (id: string) => recolherLinha(id),
    onSuccess: () => {
      invalidar();
      toast.success('Linha recolhida. Ela volta a ser um rascunho.');
    },
    onError: (err) =>
      toast.error(erroDeAcao(err, 'Não foi possível recolher a linha. Tente de novo.')),
  });

  // The wizard needs the team and the templates; same keys as the board, so the cache is shared.
  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
    enabled: fluxoItens != null,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: getWorkflowTemplates,
    enabled: fluxoItens != null,
  });

  /** Opens the wizard seeded with these rows (the selection bar's "Criar fluxo"). */
  const abrirCriarFluxo = (sel: LinhaItem[]) => {
    if (sel.length > 0) setFluxoItens(sel);
  };

  /** Seed `afterCreate`: create the rows' posts in the new fluxo, then refresh what they touch. */
  const criarPostsNoFluxo = async (linhaId: string, workflow: Workflow, sel: LinhaItem[]) => {
    await converterParaFluxo(linhaId, workflow, sel, colunasData);
    void qc.invalidateQueries({ queryKey: linhaItensKey(linhaId) });
    void qc.invalidateQueries({ queryKey: linhaPostsKey(linhaId) });
    void qc.invalidateQueries({ queryKey: linhasKey(periodo) });
    void qc.invalidateQueries({ queryKey: ['linha-origem'] });
    setSelecao({ linhaId: null, ids: [] });
  };

  const copiarHub = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link do Hub copiado.');
    } catch {
      toast.error('Não foi possível copiar o link. Copie pela página do cliente.');
    }
  };

  const resumo = useMemo(() => {
    const n = itensData.length;
    const partes = [`${n} ${n === 1 ? 'post' : 'posts'}`];
    for (const b of formatBreakdown(itensData)) partes.push(`${TIPO_RESUMO[b.tipo]} ${b.n}`);
    return partes.join(' · ');
  }, [itensData]);

  // Phone: read-only cards (spec §6.6). After every hook so the hook order never changes.
  const phone = useIsLinhaPhone();
  if (phone) {
    return (
      <LinhaPhoneView
        clientes={clientes}
        linhas={linhas}
        mes={mes}
        selectedId={selectedId}
        fotosDe={fotosDe}
        linhasLoading={base.linhas.isLoading}
        linhasError={base.linhas.isError}
        itens={itensData}
        itensLoading={itens.isLoading}
        itensError={itens.isError}
        respostas={respostasData}
        enviando={enviar.isPending}
        onSelect={(id) => onChange({ clientes: [id] })}
        onMesChange={(m) => onChange({ mes: m })}
        onEnviar={() => linha && enviar.mutate(linha.id)}
        onRetry={() => {
          void base.linhas.refetch();
          if (linha) void itens.refetch();
        }}
      />
    );
  }

  return (
    <div className="linha-view">
      <LinhaClientRail
        clientes={clientes}
        linhas={linhas}
        mes={mes}
        selectedId={selectedId}
        criandoId={criandoId}
        // An errored month shows no "Criar": the main pane carries the retry.
        carregando={base.linhas.isLoading || base.linhas.isError}
        onSelect={(id) => onChange({ clientes: [id] })}
        onCriar={(id) => criar.mutate(id)}
        onMesChange={(m) => onChange({ mes: m })}
      />
      <section className="linha-main" data-testid="linha-main">
        {base.linhas.isError ? (
          <QueryErrorCard onRetry={() => void base.linhas.refetch()} />
        ) : !cliente ? (
          <div className="linha-empty">
            <p className="linha-empty__title">Nenhum cliente ativo</p>
            <p className="linha-empty__sub">Cadastre um cliente para montar a linha editorial.</p>
          </div>
        ) : base.linhas.isLoading ? (
          <div className="linha-empty">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando" />
          </div>
        ) : !linha ? (
          <div className="linha-empty">
            <p className="linha-empty__title">Sem linha neste mês</p>
            <p className="linha-empty__sub">
              Monte o plano de {cliente.nome} e envie para aprovação no Hub.
            </p>
            <button
              type="button"
              className="linha-btn linha-btn--primary"
              disabled={criandoId === cliente.id}
              onClick={() => criar.mutate(cliente.id!)}
            >
              {criandoId === cliente.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Criar linha
            </button>
          </div>
        ) : (
          <>
            <LinhaHeader
              linha={linha}
              cliente={cliente}
              fotos={fotosDe(cliente)}
              totalItens={itens.isSuccess ? itensData.length : (linha.itens_total ?? 0)}
              hubUrl={hubUrl}
              colunasSlot={
                <ColunasPopover
                  colunas={colunasData}
                  direcaoOculta={direcaoOculta}
                  onDirecaoOcultaChange={mudarDirecaoOculta}
                />
              }
              onEnviar={() => enviar.mutate(linha.id)}
              onRecolher={() => recolher.mutate(linha.id)}
              onCopiarHub={(url) => void copiarHub(url)}
              enviando={enviar.isPending}
              recolhendo={recolher.isPending}
            />
            {linha.status === 'enviada' && (
              <p className="linha-banner" role="status">
                O cliente vê as alterações ao abrir o Hub.
              </p>
            )}
            {itens.isSuccess && <p className="linha-summary">{resumo}</p>}
            {/* The table (Task 9); the selection bar (Task 10) and the wizard (Task 11) join it. */}
            <div className="linha-table-slot" data-testid="linha-table-slot">
              {itens.isError ? (
                <QueryErrorCard onRetry={() => void itens.refetch()} />
              ) : itens.isLoading ? (
                <div className="linha-empty">
                  <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando" />
                </div>
              ) : (
                <LinhaTable
                  linha={linha}
                  itens={itensData}
                  colunas={colunasData}
                  respostas={respostasData}
                  selectedIds={selectedIds}
                  onSelect={(ids) => setSelecao({ linhaId: linha.id, ids })}
                  direcaoOculta={direcaoOculta}
                  onOpenComentarios={(itemId) => setPainel({ linhaId: linha.id, itemId })}
                />
              )}
            </div>
            {selectedIds.length > 0 && (
              <LinhaSelectionBar
                itens={itensData}
                selected={selectedIds}
                linhaStatus={linha.status}
                onCriarFluxo={() =>
                  abrirCriarFluxo(itensData.filter((i) => selectedIds.includes(i.id)))
                }
                onCriarPosts={() =>
                  setCriarPosts({
                    open: true,
                    itens: itensData.filter((i) => selectedIds.includes(i.id)),
                  })
                }
                onLimpar={() => setSelecao({ linhaId: linha.id, ids: [] })}
              />
            )}
            <CriarPostsDialog
              open={criarPosts.open}
              onOpenChange={(open) => setCriarPosts((c) => ({ ...c, open }))}
              linha={linha}
              itens={criarPosts.itens}
              colunas={colunasData}
              onDone={() => setSelecao({ linhaId: linha.id, ids: [] })}
              onVerPosts={onVerPosts}
            />
            <LinhaComentariosPanel
              open={painelAberto}
              onOpenChange={(open) => !open && setPainel(null)}
              linha={linha}
              item={painelItem}
              respostas={respostasData}
            />
            {fluxoItens && (
              <NewWorkflowWizard
                open
                onClose={() => setFluxoItens(null)}
                clientes={clientes}
                membros={membros}
                templates={templates}
                onCreated={() => {
                  captureEvent('workflow_created');
                  for (const key of [
                    'workflows',
                    'workflow-templates',
                    'all-active-etapas',
                    'workflow-covers',
                    'workflow-posts-counts',
                    'active-posts',
                  ]) {
                    void qc.invalidateQueries({ queryKey: [key] });
                  }
                }}
                seed={{
                  clienteId: linha.cliente_id,
                  nome: nomeFluxoPadrao(fluxoItens, periodo),
                  origemLabel: `linha editorial de ${mesLabel(periodo)}`,
                  itens: fluxoItens,
                  afterCreate: (workflow) => criarPostsNoFluxo(linha.id, workflow, fluxoItens),
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
