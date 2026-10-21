import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitFork,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/utils';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { byNome } from '../components/FilaMembroPicker';
import { FILA_ORDEM_LABELS, FILA_ORDEM_OPTIONS } from '../components/FilaOrdemPicker';
import '../phone/viewsPhone.css';
import type { ActivePost, Membro } from '../../../store';
import { formatPostDateFull, formatPostWeekday } from '@/utils/postDate';
import {
  dayDiff,
  formatEtapaDeadlineDay,
  formatEtapaPrazo,
  type DeadlineInfo,
} from '../etapaPrazo';
import { TIPO_LABELS } from '../postLabels';
import { TIPO_ICONS } from '../tipoIcons';
import { PostStatusChip } from '../components/PostStatusChip';
import type { StatusRegistry } from '../statusRegistry';
import {
  FILA_BUCKET_LABELS_BY_ORDEM,
  type ChegandoItem,
  type FilaBucket,
  type FilaGroup,
  type FilaItem,
  type FilaOrdem,
  type MinhaFila,
} from '../minhaFila';

export interface MinhaFilaViewProps {
  fila: MinhaFila;
  membros: Membro[];
  /** Membro efetivo (explícito ou o próprio). null = login sem membro e nada escolhido. */
  membroId: number | null;
  currentMembroId: number | null;
  /** Eixo das seções (o builder já agrupou por ele); aqui só muda a copy. */
  ordem?: FilaOrdem;
  registry: StatusRegistry;
  isLoading: boolean;
  isError: boolean;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
  /**
   * Phones only (below 768px): the "Fila de" picker moves from VistasTabs' trailing slot
   * into the view. Same contract as FilaMembroPicker: null = the user themself. Runs
   * only after the picker sheet has closed (its history entry popped), so the page may
   * remount the view on change.
   */
  onMembroChange?: (membroId: number | null) => void;
  /** Phones only: the "Ordenar" picker, same contract as FilaOrdemPicker. */
  onOrdemChange?: (ordem: FilaOrdem) => void;
}

const OPEN_BY_DEFAULT: FilaBucket[] = ['atrasado', 'hoje', 'amanha'];

type Tone = 'red' | 'amber' | 'green' | 'blue' | 'neutral';

const BUCKET_TONE: Record<FilaBucket, Tone> = {
  atrasado: 'red',
  hoje: 'amber',
  amanha: 'amber',
  proximos7: 'neutral',
  depois: 'neutral',
  sem_prazo: 'neutral',
};

const BUCKET_SUB: Record<FilaOrdem, Record<FilaBucket, string>> = {
  prazo: {
    atrasado: 'o prazo já passou',
    hoje: 'vence hoje',
    amanha: 'vence amanhã',
    proximos7: 'vence nos próximos 7 dias',
    depois: 'vence depois de 7 dias',
    sem_prazo: 'sem prazo definido',
  },
  publicacao: {
    atrasado: 'o horário de publicação já passou',
    hoje: 'publica hoje',
    amanha: 'publica amanhã',
    proximos7: 'publica nos próximos 7 dias',
    depois: 'publica depois de 7 dias',
    sem_prazo: 'sem data de publicação',
  },
};

const STAT_LABELS: Record<FilaOrdem, { atrasados: string; hoje: string }> = {
  prazo: { atrasados: 'Atrasados', hoje: 'Vencem hoje' },
  publicacao: { atrasados: 'Data passada', hoje: 'Publicam hoje' },
};

function prazoTone(deadline: DeadlineInfo): Tone {
  if (deadline.estourado) return 'red';
  if (deadline.urgente) return 'amber';
  return 'neutral';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinDot(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(' · ');
}

/** Chip de prazo só com data resolvida: sem ela o DeadlineInfo é um fallback
 *  (prazo_dias de uma etapa não iniciada, ou zerado) que leria "5d restantes". */
function PrazoChip({ prazoDate, deadline }: { prazoDate: Date | null; deadline: DeadlineInfo }) {
  if (!prazoDate) return null;
  return (
    <span className={`fila-pill fila-pill--${prazoTone(deadline)}`}>
      {formatEtapaPrazo(deadline).label}
    </span>
  );
}

function margemTone(margem: FilaItem['margem']): Tone {
  if (margem.kind === 'sem_margem') return 'red';
  if (margem.kind === 'dias' && margem.dias <= 2) return 'amber';
  return 'green';
}

/** Barra de pressão: cheia sem margem, esvaziando conforme a margem cresce. */
function margemFill(margem: FilaItem['margem']): number {
  if (margem.kind === 'sem_margem') return 100;
  if (margem.kind !== 'dias') return 0;
  return Math.max(8, Math.round(100 / (1 + 0.6 * margem.dias)));
}

function Margem({ margem }: { margem: FilaItem['margem'] }) {
  if (margem.kind === 'sem_prazo' || margem.kind === 'sem_data') {
    return <span className="fila-row-margem" />;
  }
  const tone = margemTone(margem);
  const cls =
    margem.kind === 'sem_margem'
      ? 'fila-margem--sem'
      : margem.dias <= 2
        ? 'fila-margem--curta'
        : 'fila-margem--ok';
  return (
    <span className="fila-row-margem">
      <span className={`fila-pill fila-pill--${tone} fila-margem ${cls}`}>
        {margem.kind === 'sem_margem' ? 'sem margem' : `margem ${margem.dias}d`}
      </span>
      <span className="fila-bar" aria-hidden="true">
        <span
          className={`fila-bar-fill fila-bar-fill--${tone}`}
          style={{ width: `${margemFill(margem)}%` }}
        />
      </span>
    </span>
  );
}

function Publica({ post }: { post: ActivePost }) {
  return (
    <span className="fila-publica">
      <span className="fila-publica-label">Publica</span>
      {post.scheduled_at ? (
        <span className="fila-publica-date" title={formatPostDateFull(post.scheduled_at)}>
          {formatPostWeekday(post.scheduled_at)}
        </span>
      ) : (
        <span className="fila-publica-date is-empty">sem data de publicação</span>
      )}
    </span>
  );
}

function TipoIcon({ post, dim }: { post: ActivePost; dim?: boolean }) {
  const Icon = TIPO_ICONS[post.tipo];
  return (
    <span className={`fila-row-icon${dim ? ' is-dim' : ''}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

/** "publica amanhã, 24 set" / "publica hoje, 23 set" / "publica qua, 30 set". */
function publicaRelativa(post: ActivePost, now: Date): string {
  if (!post.scheduled_at) return 'sem data de publicação';
  const d = new Date(post.scheduled_at);
  const diff = dayDiff(d, now);
  const dia = formatEtapaDeadlineDay(d, now);
  if (diff === 0) return `publica hoje, ${dia}`;
  if (diff === 1) return `publica amanhã, ${dia}`;
  return `publica ${formatPostWeekday(post.scheduled_at, now)}`;
}

/** "Design atrasado 1d" / "Design vence hoje" / "Design vence 25 set". Só para
 *  prazo de etapa: o fallback pela data de publicação já aparece como "publica". */
function etapaStatus(item: FilaItem, now: Date): string | null {
  if (item.prazoOrigem !== 'etapa' || !item.prazoDate) return null;
  const etapa = item.stage?.etapaNome ?? item.card?.etapa.nome ?? 'Etapa';
  if (item.deadline.estourado) {
    return `${etapa} atrasado ${Math.abs(item.deadline.diasRestantes)}d`;
  }
  if (dayDiff(item.prazoDate, now) === 0) return `${etapa} vence hoje`;
  return `${etapa} vence ${formatEtapaDeadlineDay(item.prazoDate, now)}`;
}

/** Contexto de uma linha. Fluxo em grupo já tem cabeçalho, então a linha
 *  agrupada só diz o tipo; a solta carrega cliente, fluxo e etapa. */
function rowContext(item: FilaItem, inGroup: boolean): string {
  const tipo = TIPO_LABELS[item.post.tipo];
  if (inGroup) return tipo;
  if (item.entity) {
    return joinDot(
      item.post.cliente_nome,
      tipo,
      'Individual',
      item.stage?.etapaNome && `etapa ${item.stage.etapaNome}`,
    );
  }
  if (item.card) return joinDot(item.post.cliente_nome, tipo, item.card.workflow.titulo);
  return joinDot(item.post.cliente_nome, tipo);
}

function PostRow({
  item,
  inGroup,
  isTop,
  registry,
  onClick,
}: {
  item: FilaItem;
  inGroup: boolean;
  isTop: boolean;
  registry: StatusRegistry;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`fila-row${isTop ? ' is-top' : ''}`} onClick={onClick}>
      <TipoIcon post={item.post} />
      <span className="fila-row-main">
        <span className="fila-row-title">{item.post.titulo}</span>
        <span className="fila-row-sub">
          <span>{rowContext(item, inGroup)}</span>
          {item.origem === 'responsavel' && <span className="fila-tag">responsável pelo post</span>}
          <PostStatusChip post={item.post} registry={registry} />
        </span>
      </span>
      <Publica post={item.post} />
      <Margem margem={item.margem} />
    </button>
  );
}

function GroupBlock({
  group,
  topKey,
  registry,
  onPostClick,
  onFluxoClick,
}: {
  group: FilaGroup;
  topKey: string | null;
  registry: StatusRegistry;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}) {
  const rows = group.items.map((item) => (
    <PostRow
      key={item.key}
      item={item}
      inGroup={group.kind === 'fluxo'}
      isTop={item.key === topKey}
      registry={registry}
      onClick={() => onPostClick(item.post)}
    />
  ));
  if (group.kind !== 'fluxo' || !group.card) return <>{rows}</>;
  const card = group.card;
  const prazo = group.prazoDate
    ? `${group.deadline.estourado ? 'venceu' : 'vence'} ${formatEtapaDeadlineDay(group.prazoDate)}`
    : null;
  return (
    <div className="fila-group">
      <button
        type="button"
        className="fila-group-head"
        onClick={() => onFluxoClick(card.workflow.id!)}
      >
        <GitFork className="fila-group-icon h-4 w-4" aria-hidden="true" />
        <span className="fila-group-title">
          {joinDot(card.cliente?.nome, card.workflow.titulo)}
        </span>
        <span className="fila-group-sub">{joinDot(`Etapa ${card.etapa.nome}`, prazo)}</span>
        <span className="fila-group-end">
          <PrazoChip prazoDate={group.prazoDate} deadline={group.deadline} />
        </span>
      </button>
      {rows}
    </div>
  );
}

/** "em Copy com Bruno" / "em Copy, sem responsável". */
function agoraEm(item: ChegandoItem): string {
  return item.responsavelAtual
    ? `em ${item.etapaAtual} com ${item.responsavelAtual}`
    : `em ${item.etapaAtual}, sem responsável`;
}

function chega(item: ChegandoItem): string {
  return item.chegaDate ? `chega ~${formatEtapaDeadlineDay(item.chegaDate)}` : 'sem previsão';
}

function ChegandoRow({
  item,
  inGroup,
  onClick,
}: {
  item: ChegandoItem;
  inGroup: boolean;
  onClick: () => void;
}) {
  const sub = inGroup
    ? TIPO_LABELS[item.post.tipo]
    : joinDot(item.post.cliente_nome, item.entity ? 'Individual' : null, agoraEm(item));
  return (
    <button type="button" className="fila-row is-chegando" onClick={onClick}>
      <TipoIcon post={item.post} dim />
      <span className="fila-row-main">
        <span className="fila-row-title">{item.post.titulo}</span>
        <span className="fila-row-sub">
          <span>{sub}</span>
        </span>
      </span>
      <Publica post={item.post} />
      <span className="fila-row-margem fila-chega">{inGroup ? null : chega(item)}</span>
    </button>
  );
}

interface ChegandoGroup {
  key: string;
  card: ChegandoItem['card'];
  items: ChegandoItem[];
}

/** Agrupamento é da vista (spec § Chegando): o builder devolve a lista plana
 *  ordenada; os filhos de um fluxo compartilham etapa atual e chegaDate. */
function groupChegando(chegando: ChegandoItem[]): ChegandoGroup[] {
  const out: ChegandoGroup[] = [];
  const byKey = new Map<string, ChegandoGroup>();
  for (const item of chegando) {
    const key = item.card ? `fluxo:${item.card.workflow.id}` : item.key;
    let g = byKey.get(key);
    if (!g) {
      g = { key, card: item.card, items: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.items.push(item);
  }
  return out;
}

function chegandoSub(chegando: ChegandoItem[]): string {
  const proximas = new Set(chegando.map((c) => c.proximaEtapa).filter(Boolean));
  return proximas.size === 1
    ? `ainda não é sua vez. ${[...proximas][0]} é a próxima etapa`
    : 'ainda não é sua vez';
}

function toggleKey<T>(prev: Set<T>, key: T): Set<T> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Linhas soltas consecutivas dividem um card; cada fluxo tem o seu. */
function sectionBlocks(groups: FilaGroup[]): { key: string; groups: FilaGroup[] }[] {
  const blocks: { key: string; groups: FilaGroup[] }[] = [];
  for (const g of groups) {
    const last = blocks[blocks.length - 1];
    if (g.kind !== 'fluxo' && last && last.groups[0].kind !== 'fluxo') {
      last.groups.push(g);
    } else {
      blocks.push({ key: g.key, groups: [g] });
    }
  }
  return blocks;
}

function ChegandoSection({
  chegando,
  onPostClick,
}: {
  chegando: ChegandoItem[];
  onPostClick: (post: ActivePost) => void;
}) {
  const groups = useMemo(() => groupChegando(chegando), [chegando]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setOpen((prev) => toggleKey(prev, key));
  const sub = chegandoSub(chegando);

  return (
    <section className="fila-section" data-testid="fila-chegando">
      <div className="fila-section-label">
        <span className="fila-pill fila-pill--blue fila-pill--lg">Chegando</span>
        <span className="fila-section-sub">{sub}</span>
      </div>
      <div className="fila-group">
        {groups.map((g) => {
          // Fluxo com um post só vira linha solta: um cabeçalho para uma linha
          // é ruído. O post já diz cliente e etapa atual.
          if (!g.card || g.items.length === 1) {
            const item = g.items[0];
            return (
              <ChegandoRow
                key={g.key}
                item={item}
                inGroup={false}
                onClick={() => onPostClick(item.post)}
              />
            );
          }
          const first = g.items[0];
          const isOpen = open.has(g.key);
          return (
            <div key={g.key} className="fila-subgroup">
              <button
                type="button"
                className="fila-group-head is-chegando"
                aria-expanded={isOpen}
                onClick={() => toggle(g.key)}
              >
                {isOpen ? (
                  <ChevronDown className="fila-group-icon h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="fila-group-icon h-4 w-4" aria-hidden="true" />
                )}
                <span className="fila-group-title">
                  {joinDot(g.card.cliente?.nome, g.card.workflow.titulo)}
                </span>
                <span className="fila-group-sub">{agoraEm(first)}</span>
                <span className="fila-group-end">
                  <span className="fila-chega">{chega(first)}</span>
                  <span className="fila-tag">{plural(g.items.length, 'post', 'posts')}</span>
                </span>
              </button>
              {isOpen &&
                g.items.map((item) => (
                  <ChegandoRow
                    key={item.key}
                    item={item}
                    inGroup
                    onClick={() => onPostClick(item.post)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="fila-stat">
      <span className="fila-stat-label">{label}</span>
      <span className={`fila-stat-value${tone && value > 0 ? ` is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

/** The loaded fila's shape: the four numbers, "Comece por aqui", then a group of rows. */
function FilaSkeleton() {
  return (
    <SkeletonStatus>
      <div className="flex flex-col gap-5">
        <div className="fila-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fila-stat gap-2">
              <Skeleton className="h-3 w-20 max-w-full" />
              <Skeleton className="h-7 w-10" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[76px] w-full rounded-[14px]" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-28 rounded-full" />
          <div className="fila-group">
            {['72%', '58%', '66%', '50%'].map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-[var(--border-color)] px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-5 w-5 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5" style={{ width: w }} />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="hidden h-5 w-24 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonStatus>
  );
}

export function MinhaFilaView({
  fila,
  membros,
  membroId,
  currentMembroId,
  ordem = 'prazo',
  registry,
  isLoading,
  isError,
  onPostClick,
  onFluxoClick,
  onMembroChange,
  onOrdemChange,
}: MinhaFilaViewProps) {
  const isPhone = !useIsDesktop(768);
  const [open, setOpen] = useState<Set<FilaBucket>>(() => new Set(OPEN_BY_DEFAULT));
  const toggle = (b: FilaBucket) => setOpen((prev) => toggleKey(prev, b));

  const now = new Date();
  const isSelf = membroId != null && membroId === currentMembroId;
  const membroNome = membros.find((m) => m.id === membroId)?.nome ?? '';
  const topKey = fila.top?.key ?? null;
  const showBody = !isLoading && !isError && membroId != null;
  const empty = showBody && fila.items.length === 0 && fila.chegando.length === 0;
  const countOf = (b: FilaBucket) => fila.sections.find((s) => s.bucket === b)?.count ?? 0;
  const top = fila.top;

  if (isPhone) {
    return (
      <FilaPhone
        fila={fila}
        membros={membros}
        membroId={membroId}
        currentMembroId={currentMembroId}
        ordem={ordem}
        registry={registry}
        isLoading={isLoading}
        isError={isError}
        onPostClick={onPostClick}
        onFluxoClick={onFluxoClick}
        onMembroChange={onMembroChange}
        onOrdemChange={onOrdemChange}
        open={open}
        onToggle={toggle}
      />
    );
  }

  return (
    <div className="fila animate-up">
      {isError && (
        <p className="fila-note">Não foi possível carregar a fila. Recarregue a página.</p>
      )}

      {!isError && isLoading && <FilaSkeleton />}

      {!isError && !isLoading && membroId == null && (
        <p className="fila-note">
          Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para
          fazer o vínculo na página Equipe. Você ainda pode ver a fila de outra pessoa pelo seletor
          acima.
        </p>
      )}

      {empty && (
        <p className="fila-note">
          {isSelf
            ? 'Nada na sua fila. Quando uma etapa ou um post for atribuído a você, ele aparece aqui.'
            : membroNome
              ? `Nada na fila de ${membroNome}.`
              : 'Nada na fila deste membro.'}
        </p>
      )}

      {showBody && !empty && (
        <div className="fila-stats" data-testid="fila-summary">
          <Stat label={STAT_LABELS[ordem].atrasados} value={fila.counts.atrasados} tone="red" />
          <Stat label={STAT_LABELS[ordem].hoje} value={countOf('hoje')} tone="amber" />
          <Stat label="Esta semana" value={countOf('amanha') + countOf('proximos7')} />
          <Stat label="Chegando" value={fila.chegando.length} />
        </div>
      )}

      {showBody && top && (
        <button
          type="button"
          className="fila-top"
          data-testid="fila-top"
          onClick={() => onPostClick(top.post)}
        >
          <span className="fila-top-icon">
            {(() => {
              const Icon = TIPO_ICONS[top.post.tipo];
              return <Icon className="h-5 w-5" aria-hidden="true" />;
            })()}
          </span>
          <span className="fila-top-body">
            <span className="fila-top-label">Comece por aqui</span>
            <span className="fila-top-title">{top.post.titulo}</span>
            <span className="fila-top-sub">
              {joinDot(
                top.post.cliente_nome,
                TIPO_LABELS[top.post.tipo],
                etapaStatus(top, now),
                publicaRelativa(top.post, now),
              )}
            </span>
          </span>
          <span className="fila-top-cta">
            Abrir post
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      )}

      {showBody &&
        fila.sections
          .filter((section) => section.count > 0)
          .map((section) => {
            const isOpen = open.has(section.bucket);
            const label = FILA_BUCKET_LABELS_BY_ORDEM[ordem][section.bucket];
            return (
              <section key={section.bucket} className="fila-section" data-bucket={section.bucket}>
                <button
                  type="button"
                  className={`fila-section-head${isOpen ? ' is-open' : ''}`}
                  aria-expanded={isOpen}
                  onClick={() => toggle(section.bucket)}
                >
                  {isOpen ? (
                    <>
                      <span
                        className={`fila-pill fila-pill--${BUCKET_TONE[section.bucket]} fila-pill--lg`}
                      >
                        {label}
                      </span>
                      <span className="fila-section-sub">{BUCKET_SUB[ordem][section.bucket]}</span>
                      <ChevronUp className="fila-section-chevron h-4 w-4" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      <span className="fila-section-name">{label}</span>
                      <span className="fila-section-sub">
                        {`${plural(section.count, 'post', 'posts')} · recolhido`}
                      </span>
                      <ChevronDown className="h-4 w-4 fila-section-sub" aria-hidden="true" />
                    </>
                  )}
                </button>
                {isOpen && (
                  <div className="fila-section-body">
                    {(() => {
                      // Linhas soltas consecutivas dividem um card; cada fluxo tem o seu.
                      const blocks = sectionBlocks(section.groups);
                      return blocks.map((b) =>
                        b.groups[0].kind === 'fluxo' ? (
                          <GroupBlock
                            key={b.key}
                            group={b.groups[0]}
                            topKey={topKey}
                            registry={registry}
                            onPostClick={onPostClick}
                            onFluxoClick={onFluxoClick}
                          />
                        ) : (
                          <div key={b.key} className="fila-group">
                            {b.groups.map((g) => (
                              <GroupBlock
                                key={g.key}
                                group={g}
                                topKey={topKey}
                                registry={registry}
                                onPostClick={onPostClick}
                                onFluxoClick={onFluxoClick}
                              />
                            ))}
                          </div>
                        ),
                      );
                    })()}
                  </div>
                )}
              </section>
            );
          })}

      {showBody && fila.chegando.length > 0 && (
        <ChegandoSection chegando={fila.chegando} onPostClick={onPostClick} />
      )}
    </div>
  );
}

// ── Phone (below 768px) ─────────────────────────────────────────────────────

const TONE_CLASS: Record<Tone, string> = {
  red: 'phone-ent-v-tone--red',
  amber: 'phone-ent-v-tone--amber',
  green: 'phone-ent-v-tone--green',
  blue: 'phone-ent-v-tone--blue',
  neutral: 'phone-ent-v-tone--neutral',
};

/** Margem as text, toned like the desktop pill ("sem margem", "margem 3d"). */
function MargemText({ margem }: { margem: FilaItem['margem'] }) {
  if (margem.kind === 'sem_prazo' || margem.kind === 'sem_data') return null;
  return (
    <span className={cn('phone-ent-v-row__end-sub', TONE_CLASS[margemTone(margem)])}>
      {margem.kind === 'sem_margem' ? 'sem margem' : `margem ${margem.dias}d`}
    </span>
  );
}

function publicaCurta(post: ActivePost): string {
  return post.scheduled_at
    ? `publica ${formatPostWeekday(post.scheduled_at)}`
    : 'sem data de publicação';
}

/** One phone row: tipo icon, title, context, chips, and the publish/margem column. */
function FilaPhoneRow({
  post,
  subtitle,
  meta,
  end,
  dim,
  isTop,
  indent,
  onClick,
}: {
  post: ActivePost;
  subtitle: string;
  meta?: ReactNode;
  end?: ReactNode;
  dim?: boolean;
  isTop?: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  const Icon = TIPO_ICONS[post.tipo];
  return (
    <li className="phone-cell">
      <button
        type="button"
        className={cn(
          'phone-cell__main phone-ent-v-row',
          dim && 'phone-ent-v-row--dim',
          isTop && 'phone-ent-v-row--top',
          indent && 'phone-ent-v-row--indent',
        )}
        onClick={onClick}
      >
        <span className="phone-cell__icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="phone-cell__body">
          <span className="phone-cell__text">
            <span className="phone-cell__label phone-ent-v-row__title">{post.titulo}</span>
            {subtitle && <span className="phone-cell__subtitle">{subtitle}</span>}
            {meta && <span className="phone-ent-v-row__meta">{meta}</span>}
          </span>
          {end && <span className="phone-ent-v-row__end">{end}</span>}
        </span>
      </button>
    </li>
  );
}

function FilaPhoneItemRow({
  item,
  inGroup,
  isTop,
  registry,
  onClick,
}: {
  item: FilaItem;
  inGroup: boolean;
  isTop: boolean;
  registry: StatusRegistry;
  onClick: () => void;
}) {
  return (
    <FilaPhoneRow
      post={item.post}
      subtitle={rowContext(item, inGroup)}
      isTop={isTop}
      indent={inGroup}
      meta={
        <>
          {item.origem === 'responsavel' && (
            <span className="phone-ent-v-tag">responsável pelo post</span>
          )}
          <PostStatusChip post={item.post} registry={registry} />
        </>
      }
      end={
        <>
          <span className="phone-ent-v-row__end-main">{publicaCurta(item.post)}</span>
          <MargemText margem={item.margem} />
        </>
      }
      onClick={onClick}
    />
  );
}

function FilaPhoneBlock({
  groups,
  topKey,
  registry,
  onPostClick,
  onFluxoClick,
}: {
  groups: FilaGroup[];
  topKey: string | null;
  registry: StatusRegistry;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}) {
  const head = groups[0];
  const card = head.kind === 'fluxo' ? head.card : undefined;
  const prazo =
    card && head.prazoDate
      ? `${head.deadline.estourado ? 'venceu' : 'vence'} ${formatEtapaDeadlineDay(head.prazoDate)}`
      : null;
  return (
    <GroupedList
      aria-label={card ? joinDot(card.cliente?.nome, card.workflow.titulo) : 'Posts'}
      className="phone-ent-v-group"
    >
      {card && (
        <Cell
          icon={<GitFork />}
          label={joinDot(card.cliente?.nome, card.workflow.titulo)}
          subtitle={joinDot(`Etapa ${card.etapa.nome}`, prazo)}
          value={
            head.prazoDate ? (
              <span className={TONE_CLASS[prazoTone(head.deadline)]}>
                {formatEtapaPrazo(head.deadline).label}
              </span>
            ) : undefined
          }
          chevron
          className="phone-ent-v-fluxo-head"
          onClick={() => onFluxoClick(card.workflow.id!)}
        />
      )}
      {groups.flatMap((g) =>
        g.items.map((item) => (
          <FilaPhoneItemRow
            key={item.key}
            item={item}
            inGroup={g.kind === 'fluxo'}
            isTop={item.key === topKey}
            registry={registry}
            onClick={() => onPostClick(item.post)}
          />
        )),
      )}
    </GroupedList>
  );
}

function FilaPhoneChegando({
  chegando,
  onPostClick,
}: {
  chegando: ChegandoItem[];
  onPostClick: (post: ActivePost) => void;
}) {
  const groups = useMemo(() => groupChegando(chegando), [chegando]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const row = (item: ChegandoItem, inGroup: boolean) => (
    <FilaPhoneRow
      key={item.key}
      post={item.post}
      dim
      indent={inGroup}
      subtitle={
        inGroup
          ? TIPO_LABELS[item.post.tipo]
          : joinDot(item.post.cliente_nome, item.entity ? 'Individual' : null, agoraEm(item))
      }
      end={
        <>
          <span className="phone-ent-v-row__end-main">{publicaCurta(item.post)}</span>
          {!inGroup && <span className="phone-ent-v-row__end-sub">{chega(item)}</span>}
        </>
      }
      onClick={() => onPostClick(item.post)}
    />
  );
  return (
    <section className="phone-ent-v-section" data-testid="fila-chegando">
      <h2 className="phone-ent-v-section-label phone-ent-v-tone--blue">
        Chegando
        <span className="phone-ent-v-section-sub">{chegandoSub(chegando)}</span>
      </h2>
      <GroupedList aria-label="Chegando" className="phone-ent-v-group">
        {groups.flatMap((g) => {
          // Fluxo com um post só vira linha solta, como no desktop.
          if (!g.card || g.items.length === 1) return [row(g.items[0], false)];
          const first = g.items[0];
          const isOpen = open.has(g.key);
          return [
            <Cell
              key={g.key}
              icon={isOpen ? <ChevronDown /> : <ChevronRight />}
              label={joinDot(g.card.cliente?.nome, g.card.workflow.titulo)}
              subtitle={agoraEm(first)}
              value={`${chega(first)} · ${plural(g.items.length, 'post', 'posts')}`}
              aria-expanded={isOpen}
              onClick={() => setOpen((prev) => toggleKey(prev, g.key))}
            />,
            ...(isOpen ? g.items.map((item) => row(item, true)) : []),
          ];
        })}
      </GroupedList>
    </section>
  );
}

function MembroPickerList({
  membros,
  membroId,
  currentMembroId,
  onChange,
}: {
  membros: Membro[];
  membroId: number | null;
  currentMembroId: number | null;
  onChange: (membroId: number | null) => void;
}) {
  const { closeThen } = useSheetActions();
  return (
    <GroupedList aria-label="Membros">
      {[...membros]
        .filter((m) => m.id != null)
        .sort(byNome)
        .map((m) => {
          const id = m.id!;
          const selected = id === membroId;
          return (
            <Cell
              key={id}
              label={id === currentMembroId ? `${m.nome} (você)` : m.nome}
              accessory={
                selected ? <Check className="phone-ent-v-check" aria-hidden="true" /> : undefined
              }
              aria-pressed={selected}
              // Close first: the page remounts the view on change, and an open sheet
              // unmounted mid-flight would leave its history entry behind.
              onClick={() =>
                closeThen(() => {
                  if (selected) return;
                  onChange(id === currentMembroId ? null : id);
                })
              }
            />
          );
        })}
    </GroupedList>
  );
}

function FilaPhone({
  fila,
  membros,
  membroId,
  currentMembroId,
  ordem,
  registry,
  isLoading,
  isError,
  onPostClick,
  onFluxoClick,
  onMembroChange,
  onOrdemChange,
  open,
  onToggle,
}: Required<Pick<MinhaFilaViewProps, 'ordem'>> &
  Omit<MinhaFilaViewProps, 'ordem'> & {
    open: Set<FilaBucket>;
    onToggle: (b: FilaBucket) => void;
  }) {
  const [picker, setPicker] = useState<'membro' | 'ordem' | null>(null);
  const now = new Date();
  const isSelf = membroId != null && membroId === currentMembroId;
  const membroNome = membros.find((m) => m.id === membroId)?.nome ?? '';
  const topKey = fila.top?.key ?? null;
  const showBody = !isLoading && !isError && membroId != null;
  const empty = showBody && fila.items.length === 0 && fila.chegando.length === 0;
  const countOf = (b: FilaBucket) => fila.sections.find((s) => s.bucket === b)?.count ?? 0;
  const top = fila.top;
  const membroLabel =
    membroId == null ? 'Escolha um membro' : `${membroNome}${isSelf ? ' (você)' : ''}`;

  const stats: { label: string; value: number; tone?: Tone }[] = [
    { label: STAT_LABELS[ordem].atrasados, value: fila.counts.atrasados, tone: 'red' },
    { label: STAT_LABELS[ordem].hoje, value: countOf('hoje'), tone: 'amber' },
    { label: 'Esta semana', value: countOf('amanha') + countOf('proximos7') },
    { label: 'Chegando', value: fila.chegando.length },
  ];

  return (
    <div className="phone-ent-v phone-ent-v-fila">
      {(onMembroChange || onOrdemChange) && (
        <div className="phone-ent-v-controls">
          {onMembroChange && (
            <button
              type="button"
              className="phone-ent-v-pill"
              aria-haspopup="dialog"
              onClick={() => setPicker('membro')}
            >
              <span>Fila de:</span>
              <strong>{membroLabel}</strong>
              <ChevronDown aria-hidden="true" />
            </button>
          )}
          {onOrdemChange && (
            <button
              type="button"
              className="phone-ent-v-pill"
              aria-haspopup="dialog"
              aria-label={`Ordenar fila por: ${FILA_ORDEM_LABELS[ordem]}`}
              onClick={() => setPicker('ordem')}
            >
              <span>{FILA_ORDEM_LABELS[ordem]}</span>
              <ArrowUpDown aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {isError && (
        <p className="phone-ent-v-note">Não foi possível carregar a fila. Recarregue a página.</p>
      )}

      {!isError && isLoading && <FilaSkeleton />}

      {!isError && !isLoading && membroId == null && (
        <p className="phone-ent-v-note">
          Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador para
          fazer o vínculo na página Equipe. Você ainda pode ver a fila de outra pessoa pelo seletor
          acima.
        </p>
      )}

      {empty && (
        <p className="phone-ent-v-note">
          {isSelf
            ? 'Nada na sua fila. Quando uma etapa ou um post for atribuído a você, ele aparece aqui.'
            : membroNome
              ? `Nada na fila de ${membroNome}.`
              : 'Nada na fila deste membro.'}
        </p>
      )}

      {showBody && !empty && (
        <div className="phone-ent-v-stats" data-testid="fila-summary">
          {stats.map((st) => (
            <div key={st.label} className="phone-ent-v-stat">
              <span
                className={cn(
                  'phone-ent-v-stat__value',
                  st.tone && st.value > 0 && TONE_CLASS[st.tone],
                )}
              >
                {st.value}
              </span>
              <span className="phone-ent-v-stat__label">{st.label}</span>
            </div>
          ))}
        </div>
      )}

      {showBody && top && (
        <button
          type="button"
          className="phone-ent-v-hero"
          data-testid="fila-top"
          onClick={() => onPostClick(top.post)}
        >
          <span className="phone-ent-v-hero__label">Comece por aqui</span>
          <span className="phone-ent-v-hero__title">{top.post.titulo}</span>
          <span className="phone-ent-v-hero__sub">
            {joinDot(
              top.post.cliente_nome,
              TIPO_LABELS[top.post.tipo],
              etapaStatus(top, now),
              publicaRelativa(top.post, now),
            )}
          </span>
          <span className="phone-ent-v-hero__cta" aria-hidden="true">
            Abrir post
          </span>
        </button>
      )}

      {showBody &&
        fila.sections
          .filter((section) => section.count > 0)
          .map((section) => {
            const isOpen = open.has(section.bucket);
            const label = FILA_BUCKET_LABELS_BY_ORDEM[ordem][section.bucket];
            return (
              <section
                key={section.bucket}
                className="phone-ent-v-section"
                data-bucket={section.bucket}
              >
                <button
                  type="button"
                  className={cn(
                    'phone-ent-v-section-head',
                    TONE_CLASS[BUCKET_TONE[section.bucket]],
                  )}
                  aria-expanded={isOpen}
                  onClick={() => onToggle(section.bucket)}
                >
                  <span className="phone-ent-v-section-head__text">
                    <span className="phone-ent-v-section-head__title">
                      {`${label} · ${section.count}`}
                    </span>
                    <span className="phone-ent-v-section-sub">
                      {isOpen ? BUCKET_SUB[ordem][section.bucket] : 'recolhido'}
                    </span>
                  </span>
                  {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </button>
                {isOpen &&
                  sectionBlocks(section.groups).map((b) => (
                    <FilaPhoneBlock
                      key={b.key}
                      groups={b.groups}
                      topKey={topKey}
                      registry={registry}
                      onPostClick={onPostClick}
                      onFluxoClick={onFluxoClick}
                    />
                  ))}
              </section>
            );
          })}

      {showBody && fila.chegando.length > 0 && (
        <FilaPhoneChegando chegando={fila.chegando} onPostClick={onPostClick} />
      )}

      {onMembroChange && (
        <BottomSheet
          open={picker === 'membro'}
          onOpenChange={(next) => setPicker(next ? 'membro' : null)}
          title="Fila de"
          detents={['medium', 'large']}
        >
          <MembroPickerList
            membros={membros}
            membroId={membroId}
            currentMembroId={currentMembroId}
            onChange={onMembroChange}
          />
        </BottomSheet>
      )}

      {onOrdemChange && (
        <ActionSheet
          open={picker === 'ordem'}
          onOpenChange={(next) => setPicker(next ? 'ordem' : null)}
          title="Ordenar fila por"
          actions={FILA_ORDEM_OPTIONS.map((o) => ({
            label: (
              <>
                {FILA_ORDEM_LABELS[o]}
                {o === ordem && <span className="sr-only">, selecionado</span>}
              </>
            ),
            icon: o === ordem ? <Check /> : undefined,
            onSelect: () => {
              if (o !== ordem) onOrdemChange(o);
            },
          }))}
        />
      )}
    </div>
  );
}
