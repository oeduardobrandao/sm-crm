import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ListSkeleton } from '@/components/ui/skeletons';
import { getClientes } from '../../../store';
import { useTodayCard } from '../useTodayCard';
import { HORIZON_DAYS, type AgendaBucket, type AgendaItem } from '../todayAgenda';
import {
  countPerDay,
  groupAgendaItems,
  oldestOverdueDays,
  type AgendaGroup,
  type AgendaGroupMode,
} from '../todayGroups';
import { TodayRow, initials } from './TodayCard';
import { PessoaAvatar } from '@/components/PessoaAvatar';

const BUCKETS: AgendaBucket[] = ['atrasado', 'hoje', 'proximos'];
const GROUP_ROWS = 6;

const isPost = (k: AgendaItem['kind']) =>
  k === 'post_agendado' || k === 'post_aguardando_cliente' || k === 'post_pendente';

/** The item's context without the group's own name (it already heads the group). */
function contextWithout(item: AgendaItem, name: string): string {
  if (!name) return item.context;
  return item.context
    .split(' · ')
    .filter((part) => part !== name)
    .join(' · ');
}

/**
 * Vidro Início "Prazos": three bucket tiles (atrasados, hoje, próximos 7 dias) choose which
 * bucket the list below shows, folded by client, responsible or day so a big agency reads one
 * line per client instead of one per item. Data, role gating and the inline "concluir tarefa"
 * come from useTodayCard, like the classic "Hoje" card.
 */
export function InicioPrazos({ onlyMine }: { onlyMine: boolean }) {
  const { t, status, scope, membroId, now, buckets, complete } = useTodayCard();
  const mine = scope === 'mine';
  const filterMine = onlyMine && !mine;

  const visible = useMemo(() => {
    if (!filterMine) return buckets;
    const keep = (items: AgendaItem[]) =>
      membroId == null ? [] : items.filter((i) => i.responsavel?.id === membroId);
    return {
      atrasado: keep(buckets.atrasado),
      hoje: keep(buckets.hoje),
      proximos: keep(buckets.proximos),
    };
  }, [buckets, filterMine, membroId]);

  const [picked, setPicked] = useState<AgendaBucket | null>(null);
  const bucket: AgendaBucket = picked ?? BUCKETS.find((b) => visible[b].length > 0) ?? 'atrasado';

  const defaultMode = (b: AgendaBucket): AgendaGroupMode => (b === 'proximos' ? 'dia' : 'cliente');
  const [modes, setModes] = useState<Partial<Record<AgendaBucket, AgendaGroupMode>>>({});
  const modeOptions: AgendaGroupMode[] = mine
    ? ['cliente', 'dia']
    : ['cliente', 'responsavel', 'dia'];
  const requested = modes[bucket] ?? defaultMode(bucket);
  const mode = modeOptions.includes(requested) ? requested : 'cliente';

  // Open group per bucket+mode; undefined = the first group, null = all closed.
  const [openKeys, setOpenKeys] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Same key and fetcher as DashboardPage, so this reads the cached list for avatar colours.
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes, retry: 1 });
  const clienteById = useMemo(() => {
    const map = new Map<number, { cor: string; sigla: string }>();
    for (const c of clientes.data ?? []) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes.data]);

  const groups = useMemo(
    () =>
      groupAgendaItems(visible[bucket], mode, {
        semCliente: t('inicio.semCliente'),
        semResponsavel: t('inicio.semResponsavel'),
      }),
    [visible, bucket, mode, t],
  );

  const viewKey = `${bucket}:${mode}`;
  const openKey = openKeys[viewKey] === undefined ? (groups[0]?.key ?? null) : openKeys[viewKey];

  const kindsSummary = (items: AgendaItem[]) => {
    const tarefas = items.filter((i) => i.kind === 'tarefa').length;
    const etapas = items.filter((i) => i.kind === 'etapa').length;
    const posts = items.filter((i) => isPost(i.kind)).length;
    const outros = items.length - tarefas - etapas - posts;
    return [
      tarefas && t('inicio.tileSub.tarefas', { count: tarefas }),
      etapas && t('inicio.tileSub.etapas', { count: etapas }),
      posts && t('inicio.tileSub.posts', { count: posts }),
      outros && t('inicio.tileSub.outros', { count: outros }),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const dayLabel = (d: Date) => {
    const s = format(d, "EEEE, d 'de' MMMM", { locale: ptBR });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const groupName = (g: AgendaGroup) =>
    mode === 'dia' ? (g.day ? dayLabel(g.day) : t('inicio.semData')) : g.label;

  const groupMeta = (g: AgendaGroup) => {
    if (mode === 'dia') {
      const names = [...new Set(g.items.map((i) => i.cliente?.nome).filter(Boolean))] as string[];
      if (names.length === 0) return kindsSummary(g.items);
      return names.length > 2
        ? t('inicio.groupMeta.clientsMore', {
            names: names.slice(0, 2).join(', '),
            count: names.length - 2,
          })
        : t('inicio.groupMeta.clients', { names: names.join(', ') });
    }
    if (bucket === 'atrasado') {
      const days = oldestOverdueDays(g.items, now);
      return days > 0 ? t('inicio.groupMeta.oldest', { count: days }) : kindsSummary(g.items);
    }
    if (bucket === 'proximos') {
      const first = g.items.find((i) => i.when)?.when;
      return first
        ? t('inicio.groupMeta.next', {
            date: format(first, "EEEEEE, d 'de' MMM", { locale: ptBR }),
          })
        : kindsSummary(g.items);
    }
    return kindsSummary(g.items);
  };

  const lead = (g: AgendaGroup) => {
    if (mode === 'dia') {
      return (
        <span className="inicio-prazos__lead is-day" aria-hidden>
          {g.day ? g.day.getDate() : '?'}
        </span>
      );
    }
    const c = mode === 'cliente' && g.clienteId != null ? clienteById.get(g.clienteId) : undefined;
    return (
      <span
        className="inicio-prazos__lead"
        style={c?.cor ? { background: c.cor } : undefined}
        aria-hidden
      >
        {g.rest ? '?' : (c?.sigla ?? initials(g.label))}
      </span>
    );
  };

  const people = (g: AgendaGroup) => {
    if (mode === 'responsavel' || mine) return [];
    const seen = new Map<number, NonNullable<AgendaItem['responsavel']>>();
    for (const i of g.items) if (i.responsavel) seen.set(i.responsavel.id, i.responsavel);
    return [...seen.values()].slice(0, 3);
  };

  const tileSub = (b: AgendaBucket) => {
    const items = visible[b];
    if (items.length === 0) return t('inicio.tileSub.nothing');
    if (b === 'atrasado') {
      const clients = new Set(items.map((i) => i.cliente?.nome).filter(Boolean)).size;
      const days = oldestOverdueDays(items, now);
      return [
        clients > 0 && t('inicio.tileSub.clients', { count: clients }),
        days > 0 && t('inicio.tileSub.oldest', { count: days }),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    return kindsSummary(items);
  };

  const perDay = countPerDay(visible.proximos, now, HORIZON_DAYS);
  const maxPerDay = Math.max(1, ...perDay);
  const dayNames = perDay.map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() + i + 1);
    return format(d, 'EEEEEE', { locale: ptBR });
  });

  if (status !== 'ready') {
    return (
      <section className="inicio-prazos" aria-label={t('inicio.prazos')}>
        {status === 'loading' ? (
          <ListSkeleton rows={4} />
        ) : (
          <p className="inicio-prazos__note">
            {status === 'role_error'
              ? t('today.roleError')
              : status === 'no_membership'
                ? t('today.noMembership')
                : t('agentPending.semVinculo')}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="inicio-prazos" aria-label={t('inicio.prazos')}>
      <div className="inicio-prazos__tiles" role="group" aria-label={t('inicio.prazos')}>
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            className="inicio-prazos__tile"
            data-bucket={b}
            aria-pressed={bucket === b}
            onClick={() => setPicked(b)}
          >
            <span className="inicio-prazos__tile-label">{t(`inicio.tiles.${b}`)}</span>
            <span className="inicio-prazos__tile-count">{visible[b].length}</span>
            {b === 'proximos' && visible.proximos.length > 0 ? (
              <span
                className="inicio-prazos__bars"
                role="img"
                aria-label={t('inicio.barsLabel', {
                  list: perDay.map((n, i) => `${dayNames[i]} ${n}`).join(', '),
                })}
              >
                {perDay.map((n, i) => (
                  <span key={i} className="inicio-prazos__bar">
                    <span
                      className="inicio-prazos__bar-fill"
                      data-empty={n === 0 || undefined}
                      style={{ height: `${Math.max(3, Math.round((n / maxPerDay) * 22))}px` }}
                    />
                    <span className="inicio-prazos__bar-day">{dayNames[i]}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="inicio-prazos__tile-sub">{tileSub(b)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="inicio-prazos__list">
        <div className="inicio-prazos__head">
          <h2 className="inicio-prazos__title">{t(`inicio.tiles.${bucket}`)}</h2>
          <span className="inicio-prazos__groupby" id="inicio-groupby">
            {t('inicio.groupBy')}
          </span>
          <div data-slot="toggle-group" role="group" aria-labelledby="inicio-groupby">
            {modeOptions.map((m) => (
              <button
                key={m}
                type="button"
                data-slot="toggle-group-item"
                data-state={mode === m ? 'on' : 'off'}
                aria-pressed={mode === m}
                onClick={() => setModes((prev) => ({ ...prev, [bucket]: m }))}
              >
                {t(`inicio.modes.${m}`)}
              </button>
            ))}
          </div>
          <Link to="/calendario" className="inicio-prazos__link">
            {t('today.calendar')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {filterMine && membroId == null ? (
          <p className="inicio-prazos__note">{t('inicio.mineMissing')}</p>
        ) : groups.length === 0 ? (
          <p className="inicio-prazos__note">{t(`inicio.listEmpty.${bucket}`)}</p>
        ) : (
          groups.map((g) => {
            const open = g.key === openKey;
            const name = groupName(g);
            const who = people(g);
            const rowsKey = `${viewKey}:${g.key}`;
            const limit = expanded.has(rowsKey) ? g.items.length : GROUP_ROWS;
            const hidden = g.items.length - limit;
            const panelId = `inicio-group-${bucket}-${mode}-${g.key}`.replace(/[^\w-]/g, '_');
            return (
              <div key={g.key} className="inicio-prazos__group" data-open={open || undefined}>
                <button
                  type="button"
                  className="inicio-prazos__group-row"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpenKeys((prev) => ({ ...prev, [viewKey]: open ? null : g.key }))
                  }
                >
                  {lead(g)}
                  <span className="inicio-prazos__group-text">
                    <span className="inicio-prazos__group-name">{name}</span>
                    <span className="inicio-prazos__group-meta">{groupMeta(g)}</span>
                  </span>
                  {who.length > 0 && (
                    // The names sit on the stack, not on each avatar: a wrapper per avatar
                    // would break the vidro overlap, which keys off :first-child.
                    <span
                      className="inicio-prazos__people"
                      title={who.map((p) => p.nome).join(', ')}
                      aria-hidden
                    >
                      {who.map((p) => (
                        <PessoaAvatar
                          key={p.id}
                          nome={p.nome}
                          fotoUrl={p.avatar_url}
                          seed={p.id}
                          className="inicio-prazos__person"
                        />
                      ))}
                    </span>
                  )}
                  <span className="inicio-prazos__count" data-bucket={bucket}>
                    {g.items.length}
                    <span className="sr-only">{` ${t('inicio.items', { count: g.items.length })}`}</span>
                  </span>
                  <ChevronRight className="inicio-prazos__chevron h-4 w-4" aria-hidden />
                </button>
                {open && (
                  <div className="inicio-prazos__items" id={panelId}>
                    {g.items.slice(0, limit).map((item) => (
                      <TodayRow
                        key={item.key}
                        item={item}
                        complete={complete}
                        context={mode === 'cliente' ? contextWithout(item, g.label) : item.context}
                        showWho={mode !== 'responsavel'}
                      />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        className="inicio-prazos__more"
                        onClick={() => setExpanded((prev) => new Set(prev).add(rowsKey))}
                      >
                        {t('inicio.moreItems', { count: hidden })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
