import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { ActivePost, Membro } from '../../../store';
import { formatPostDate } from '@/utils/postDate';
import { formatEtapaDeadlineDay, formatEtapaPrazo, type DeadlineInfo } from '../etapaPrazo';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from '../components/PostStatusChip';
import type { StatusRegistry } from '../statusRegistry';
import {
  FILA_BUCKET_LABELS,
  type ChegandoItem,
  type FilaBucket,
  type FilaGroup,
  type FilaItem,
  type MinhaFila,
} from '../minhaFila';

export interface MinhaFilaViewProps {
  fila: MinhaFila;
  membros: Membro[];
  /** Membro efetivo (explícito ou o próprio). null = login sem membro e nada escolhido. */
  membroId: number | null;
  currentMembroId: number | null;
  registry: StatusRegistry;
  isLoading: boolean;
  isError: boolean;
  /** null = "o próprio usuário" (escolher a si mesmo no seletor). */
  onMembroChange: (membroId: number | null) => void;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}

const OPEN_BY_DEFAULT: FilaBucket[] = ['atrasado', 'hoje', 'amanha'];

function prazoClass(deadline: DeadlineInfo): string {
  if (deadline.estourado) return 'deadline-overdue';
  if (deadline.urgente) return 'deadline-warning';
  return 'deadline-ok';
}

/** Chip de prazo só com data resolvida: sem ela o DeadlineInfo é um fallback
 *  (prazo_dias de uma etapa não iniciada, ou zerado) que leria "5d restantes". */
function PrazoChip({ prazoDate, deadline }: { prazoDate: Date | null; deadline: DeadlineInfo }) {
  if (!prazoDate) return null;
  return (
    <span className={`board-card-deadline ${prazoClass(deadline)}`}>
      {formatEtapaPrazo(deadline).label}
    </span>
  );
}

function MargemChip({ margem }: { margem: FilaItem['margem'] }) {
  if (margem.kind === 'sem_prazo' || margem.kind === 'sem_data') return null;
  if (margem.kind === 'sem_margem')
    return <span className="fila-margem fila-margem--sem">sem margem</span>;
  return (
    <span className={`fila-margem ${margem.dias <= 2 ? 'fila-margem--curta' : 'fila-margem--ok'}`}>
      margem {margem.dias}d
    </span>
  );
}

function publicaLabel(post: ActivePost): string {
  return post.scheduled_at
    ? `publica ${formatPostDate(post.scheduled_at)}`
    : 'sem data de publicação';
}

function joinDot(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(' · ');
}

/** Contexto de uma linha: onde o post está. Fluxo em grupo já tem cabeçalho,
 *  então a linha solta é que carrega cliente/fluxo/etapa. */
function rowContext(item: FilaItem, inGroup: boolean): string | null {
  if (inGroup) return null;
  if (item.entity) return joinDot(item.post.cliente_nome, 'Individual', item.stage?.etapaNome);
  if (item.card) return joinDot(item.post.cliente_nome, item.card.workflow.titulo);
  return item.post.cliente_nome || null;
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
  const context = rowContext(item, inGroup);
  return (
    <button type="button" className={`fila-row${isTop ? ' is-top' : ''}`} onClick={onClick}>
      <span className="fila-row-main">
        <span className="fila-row-title">{item.post.titulo}</span>
        <span className="fila-tag">{TIPO_LABELS[item.post.tipo]}</span>
        <PostStatusChip post={item.post} registry={registry} />
        {item.origem === 'responsavel' && <span className="fila-tag">responsável pelo post</span>}
        {context && <span className="fila-row-sub">{context}</span>}
      </span>
      <span className="fila-row-meta">
        <span>{publicaLabel(item.post)}</span>
        <MargemChip margem={item.margem} />
      </span>
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
  if (group.kind !== 'fluxo' || !group.card) return <div className="fila-group">{rows}</div>;
  const card = group.card;
  const n = group.items.length;
  return (
    <div className="fila-group">
      <button
        type="button"
        className="fila-group-head"
        onClick={() => onFluxoClick(card.workflow.id!)}
      >
        <span>{joinDot(card.cliente?.nome, card.workflow.titulo, card.etapa.nome)}</span>
        <PrazoChip prazoDate={group.prazoDate} deadline={group.deadline} />
        <span className="fila-tag">{n === 1 ? '1 post' : `${n} posts`}</span>
      </button>
      {rows}
    </div>
  );
}

function ChegandoGroups({
  chegando,
  onPostClick,
}: {
  chegando: ChegandoItem[];
  onPostClick: (post: ActivePost) => void;
}) {
  // Agrupamento é da vista (spec § Chegando): o builder devolve a lista plana
  // ordenada; os filhos de um fluxo compartilham etapa atual e chegaDate.
  const groups = useMemo(() => {
    const out: { key: string; card: ChegandoItem['card']; items: ChegandoItem[] }[] = [];
    const byKey = new Map<string, (typeof out)[number]>();
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
  }, [chegando]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const agoraEm = (item: ChegandoItem) =>
    `agora em ${item.etapaAtual} (${item.responsavelAtual || 'sem responsável'})`;
  const chega = (item: ChegandoItem) =>
    item.chegaDate ? `chega ~${formatEtapaDeadlineDay(item.chegaDate)}` : 'sem previsão';

  return (
    <section className="fila-section" data-testid="fila-chegando">
      <h3 className="fila-section-title">Chegando</h3>
      <p className="fila-section-sub">Posts cuja próxima etapa é sua.</p>
      {groups.map((g) => {
        if (!g.card) {
          const item = g.items[0];
          return (
            <div key={g.key} className="fila-group">
              <button type="button" className="fila-row" onClick={() => onPostClick(item.post)}>
                <span className="fila-row-main">
                  <span className="fila-row-title">{item.post.titulo}</span>
                  <span className="fila-row-sub">
                    {joinDot(
                      item.post.cliente_nome,
                      item.entity ? 'Individual' : null,
                      agoraEm(item),
                    )}
                  </span>
                </span>
                <span className="fila-row-meta">{chega(item)}</span>
              </button>
            </div>
          );
        }
        const first = g.items[0];
        const isOpen = open.has(g.key);
        const n = g.items.length;
        return (
          <div key={g.key} className="fila-group">
            <button
              type="button"
              className="fila-group-head"
              aria-expanded={isOpen}
              onClick={() => toggle(g.key)}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>{joinDot(g.card.cliente?.nome, g.card.workflow.titulo, agoraEm(first))}</span>
              <span className="fila-row-meta">{chega(first)}</span>
              <span className="fila-tag">{n === 1 ? '1 post' : `${n} posts`}</span>
            </button>
            {isOpen &&
              g.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="fila-row"
                  onClick={() => onPostClick(item.post)}
                >
                  <span className="fila-row-main">
                    <span className="fila-row-title">{item.post.titulo}</span>
                  </span>
                  <span className="fila-row-meta">{publicaLabel(item.post)}</span>
                </button>
              ))}
          </div>
        );
      })}
    </section>
  );
}

export function MinhaFilaView({
  fila,
  membros,
  membroId,
  currentMembroId,
  registry,
  isLoading,
  isError,
  onMembroChange,
  onPostClick,
  onFluxoClick,
}: MinhaFilaViewProps) {
  const [open, setOpen] = useState<Set<FilaBucket>>(() => new Set(OPEN_BY_DEFAULT));
  const toggle = (b: FilaBucket) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const isSelf = membroId != null && membroId === currentMembroId;
  const membroNome = membros.find((m) => m.id === membroId)?.nome ?? '';
  const { total, atrasados } = fila.counts;
  const topKey = fila.top?.key ?? null;
  const showBody = !isLoading && !isError && membroId != null;
  const empty = showBody && fila.items.length === 0;

  return (
    <div className="fila animate-up">
      <div className="fila-head">
        <span className="fila-head-label">Fila de</span>
        <div className="fila-head-select">
          <Select
            value={membroId != null ? String(membroId) : ''}
            onValueChange={(v) => {
              const id = parseInt(v, 10);
              if (isNaN(id)) return;
              onMembroChange(id === currentMembroId ? null : id);
            }}
          >
            <SelectTrigger className="h-8 rounded-full text-xs" aria-label="Fila de">
              <SelectValue placeholder="Escolha um membro" />
            </SelectTrigger>
            <SelectContent>
              {membros.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showBody && (
          <span className="fila-summary" data-testid="fila-summary">
            {`${total} ${total === 1 ? 'post' : 'posts'}`}
            {atrasados > 0 && (
              <span className="fila-summary-danger">
                {` · ${atrasados} ${atrasados === 1 ? 'atrasado' : 'atrasados'}`}
              </span>
            )}
          </span>
        )}
      </div>

      {isError && (
        <p className="fila-note">Não foi possível carregar a fila. Recarregue a página.</p>
      )}

      {!isError && isLoading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Spinner size="md" />
        </div>
      )}

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

      {showBody && fila.top && (
        <button
          type="button"
          className="fila-top"
          data-testid="fila-top"
          onClick={() => onPostClick(fila.top!.post)}
        >
          <span className="fila-top-label">Comece por aqui</span>
          <span className="fila-row-main">
            <span className="fila-row-title">{fila.top.post.titulo}</span>
            <span className="fila-row-sub">
              {joinDot(
                fila.top.post.cliente_nome,
                fila.top.card?.workflow.titulo ?? (fila.top.entity ? 'Individual' : null),
                fila.top.stage?.etapaNome,
              )}
            </span>
          </span>
          <span className="fila-row-meta">
            {fila.top.prazoDate && (
              <span>etapa vence {formatEtapaDeadlineDay(fila.top.prazoDate)}</span>
            )}
            <PrazoChip prazoDate={fila.top.prazoDate} deadline={fila.top.deadline} />
            <span>{publicaLabel(fila.top.post)}</span>
            <MargemChip margem={fila.top.margem} />
          </span>
        </button>
      )}

      {showBody &&
        fila.items.length > 0 &&
        fila.sections.map((section) => {
          const isOpen = section.count > 0 && open.has(section.bucket);
          const label = `${FILA_BUCKET_LABELS[section.bucket]} (${section.count})`;
          return (
            <section key={section.bucket} className="fila-section" data-bucket={section.bucket}>
              <button
                type="button"
                className={`fila-section-head${section.bucket === 'atrasado' && section.count > 0 ? ' is-danger' : ''}`}
                aria-expanded={isOpen}
                aria-disabled={section.count === 0}
                onClick={() => section.count > 0 && toggle(section.bucket)}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {label}
              </button>
              {isOpen &&
                section.groups.map((group) => (
                  <GroupBlock
                    key={group.key}
                    group={group}
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
        <ChegandoGroups chegando={fila.chegando} onPostClick={onPostClick} />
      )}
    </div>
  );
}
