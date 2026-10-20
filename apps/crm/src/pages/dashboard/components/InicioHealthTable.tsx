import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { ListSkeleton } from '@/components/ui/skeletons';
import {
  getClientHealthMonitor,
  type ClientHealth,
  type ClientHealthSummary as Summary,
} from '../../../services/clientHealth';
import type { HealthStatus } from '../../../lib/health/score';
import { filterAndSortClients, type HealthFilterKey } from '../../../lib/health/filter';
import { useClientHealthActions } from '../useClientHealthActions';
import { pipelineText } from './PipelineRow';

const TABLE_ROWS = 8;
const STALE_POST_DAYS = 7;

type Tone = 'bad' | 'warn' | 'info' | 'ok' | 'neutral';

const STATUS_TONE: Record<HealthStatus, Tone> = {
  reconectar: 'bad',
  em_queda: 'bad',
  sem_sincronizar: 'info',
  atencao: 'warn',
  inativo: 'warn',
  em_alta: 'ok',
  saudavel: 'ok',
  estavel: 'neutral',
  desconectado: 'neutral',
  sem_dados: 'neutral',
  sincronizando: 'neutral',
};

const CHIPS: { key: HealthFilterKey; label: string; count: (s: Summary) => number }[] = [
  { key: 'acao', label: 'inicio.health.acao', count: (s) => s.precisamAtencao },
  { key: 'conexao', label: 'health.chips.conexao', count: (s) => s.conexao },
  { key: 'atencao', label: 'health.chips.atencao', count: (s) => s.atencao },
  { key: 'estaveis', label: 'health.chips.estaveis', count: (s) => s.estaveis },
  { key: 'saudaveis', label: 'health.chips.saudaveis', count: (s) => s.saudaveis },
  { key: 'todos', label: 'health.chips.todos', count: (s) => s.total },
];

const EMPTY_SUMMARY: Summary = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

/** The one-line "why" under a client's status, as an i18n key plus its values; null for the
 *  healthy tiers, which need no explanation. */
export function healthReason(
  c: ClientHealth,
  nowMs: number,
): { key: string; values?: Record<string, number | string> } | null {
  switch (c.status) {
    case 'reconectar':
    case 'desconectado':
    case 'sincronizando':
    case 'sem_dados':
      return { key: `inicio.health.why.${c.status}` };
    case 'sem_sincronizar': {
      const synced = c.last_synced_at ? Date.parse(c.last_synced_at) : NaN;
      const days = Number.isFinite(synced)
        ? Math.max(1, Math.floor((nowMs - synced) / 86_400_000))
        : 0;
      return days > 0
        ? { key: 'inicio.health.why.sem_sincronizar', values: { count: days } }
        : { key: 'inicio.health.why.sem_dados' };
    }
    case 'inativo':
      return c.days_since_last_post == null
        ? { key: 'inicio.health.why.inativoNever' }
        : { key: 'inicio.health.why.inativo', values: { count: c.days_since_last_post } };
    case 'em_queda':
    case 'atencao': {
      const pct = (n: number) => Math.round(Math.abs(n) * 10) / 10;
      if (c.reach_trend_pct <= -10)
        return { key: 'inicio.health.why.reach', values: { pct: pct(c.reach_trend_pct) } };
      if (c.follower_delta_pct < 0)
        return { key: 'inicio.health.why.followers', values: { pct: pct(c.follower_delta_pct) } };
      if (c.days_since_last_post != null && c.days_since_last_post >= STALE_POST_DAYS)
        return { key: 'inicio.health.why.lastPost', values: { count: c.days_since_last_post } };
      return { key: 'inicio.health.why.generic' };
    }
    default:
      return null;
  }
}

function Delta({ pct, locale }: { pct: number; locale: string }) {
  if (!pct) return null;
  const up = pct > 0;
  return (
    <span className="inicio-health__delta" data-dir={up ? 'up' : 'down'}>
      {up ? '▲' : '▼'} {Math.abs(pct).toLocaleString(locale, { maximumFractionDigits: 1 })}%
    </span>
  );
}

function HealthRow({ c, locale, nowMs }: { c: ClientHealth; locale: string; nowMs: number }) {
  const { t } = useTranslation('dashboard');
  const { busy, handleConnect, handleSync } = useClientHealthActions(c);
  const reason = healthReason(c, nowMs);
  const noMetrics = c.status === 'desconectado' || c.status === 'reconectar';
  const n = (v: number) => v.toLocaleString(locale);

  let action;
  if (c.status === 'reconectar' || c.status === 'desconectado') {
    action = (
      <button
        type="button"
        className="inicio-health__action is-primary"
        disabled={busy}
        onClick={handleConnect}
      >
        {c.status === 'reconectar' ? t('health.cta.reconectar') : t('health.cta.conectar')}
      </button>
    );
  } else if (c.status === 'sem_sincronizar') {
    action = (
      <button type="button" className="inicio-health__action" disabled={busy} onClick={handleSync}>
        {t('health.cta.sincronizar')}
      </button>
    );
  } else if (c.status === 'inativo') {
    action = (
      <Link to={`/clientes/${c.client_id}/entregas`} className="inicio-health__action">
        {t('inicio.health.entregas')}
      </Link>
    );
  } else {
    action = (
      <Link to={`/analytics/${c.client_id}`} className="inicio-health__action">
        {t('health.cta.analytics')}
      </Link>
    );
  }

  return (
    <tr>
      <th scope="row" className="inicio-health__client">
        <Link to={`/clientes/${c.client_id}`} className="inicio-health__client-link">
          {c.profile_picture_url ? (
            <img src={c.profile_picture_url} alt="" className="inicio-health__avatar" />
          ) : (
            <span
              className="inicio-health__avatar"
              style={{ background: c.client_cor }}
              aria-hidden
            >
              {c.client_sigla}
            </span>
          )}
          <span className="inicio-health__client-text">
            <span className="inicio-health__name">{c.client_name}</span>
            {c.username && <span className="inicio-health__user">@{c.username}</span>}
          </span>
        </Link>
      </th>
      <td>
        <span className="inicio-health__status">
          <span className="inicio-health__pill" data-tone={STATUS_TONE[c.status]}>
            {t(`health.status.${c.status}`)}
          </span>
          {reason && <span className="inicio-health__why">{t(reason.key, reason.values)}</span>}
        </span>
      </td>
      <td className="is-num">
        {!noMetrics && (
          <span className="inicio-health__metric">
            <span>{n(c.follower_count)}</span>
            <Delta pct={c.follower_delta_pct} locale={locale} />
          </span>
        )}
      </td>
      <td className="is-num">
        {!noMetrics && `${c.engagement_rate.toLocaleString(locale, { maximumFractionDigits: 2 })}%`}
      </td>
      <td className="is-num">
        {!noMetrics && (
          <span className="inicio-health__metric">
            <span>{n(c.reach_28d)}</span>
            <Delta pct={c.reach_trend_pct} locale={locale} />
          </span>
        )}
      </td>
      <td
        className="is-num"
        data-stale={
          c.days_since_last_post == null || c.days_since_last_post >= STALE_POST_DAYS || undefined
        }
      >
        {c.days_since_last_post == null
          ? t('health.lastPost.never')
          : t('health.lastPost.days', { count: c.days_since_last_post })}
      </td>
      <td className="inicio-health__pipe">{pipelineText(c.pipeline, t)}</td>
      <td className="inicio-health__action-cell">{action}</td>
    </tr>
  );
}

/**
 * Vidro Início "Saúde dos clientes": one table row per client instead of a card grid, opening
 * on the clients that need action. Same data and actions as ClientHealthMonitor.
 */
export function InicioHealthTable() {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [picked, setPicked] = useState<HealthFilterKey | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clientHealth'],
    queryFn: () => getClientHealthMonitor(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const clients = data?.clients ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;
  const filter: HealthFilterKey = picked ?? (summary.precisamAtencao > 0 ? 'acao' : 'todos');
  const rows = filterAndSortClients(clients, { filter, search, sort: 'atencao' });
  const shown = showAll ? rows : rows.slice(0, TABLE_ROWS);

  let body;
  if (isLoading) body = <ListSkeleton rows={4} />;
  else if (isError) body = <p className="inicio-health__note">{t('health.error')}</p>;
  else if (clients.length === 0)
    body = <p className="inicio-health__note">{t('health.empty.noClients')}</p>;
  else if (rows.length === 0)
    body = <p className="inicio-health__note">{t('health.empty.filtered')}</p>;
  else
    body = (
      <>
        <div className="inicio-health__scroll">
          <table className="inicio-health__table">
            <thead>
              <tr>
                <th scope="col">{t('inicio.health.cols.cliente')}</th>
                <th scope="col">{t('inicio.health.cols.situacao')}</th>
                <th scope="col" className="is-num">
                  {t('inicio.health.cols.seguidores')}
                </th>
                <th scope="col" className="is-num">
                  {t('inicio.health.cols.engajamento')}
                </th>
                <th scope="col" className="is-num">
                  {t('inicio.health.cols.alcance')}
                </th>
                <th scope="col" className="is-num">
                  {t('inicio.health.cols.ultimoPost')}
                </th>
                <th scope="col">{t('inicio.health.cols.producao')}</th>
                <th scope="col">
                  <span className="sr-only">{t('inicio.health.cols.acao')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <HealthRow key={c.client_id} c={c} locale={locale} nowMs={nowMs} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="inicio-health__foot">
          <span>{t('inicio.health.showing', { shown: shown.length, total: rows.length })}</span>
          {rows.length > TABLE_ROWS && (
            <button
              type="button"
              className="inicio-health__more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? t('inicio.health.showLess') : t('inicio.health.showAll')}
            </button>
          )}
        </div>
      </>
    );

  return (
    <section className="inicio-health" aria-labelledby="inicio-health-title">
      <div className="inicio-health__head">
        <h2 id="inicio-health-title" className="inicio-health__title">
          {t('health.title')}
        </h2>
        <div className="inicio-health__chips" role="group" aria-label={t('health.title')}>
          {CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inicio-health__chip"
              aria-pressed={filter === chip.key}
              onClick={() => {
                setPicked(chip.key);
                setShowAll(false);
              }}
            >
              {t(chip.label)} <span className="inicio-health__chip-n">{chip.count(summary)}</span>
            </button>
          ))}
        </div>
        <label className="inicio-health__search">
          <Search className="h-3.5 w-3.5" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('health.search')}
            aria-label={t('health.search')}
          />
        </label>
      </div>
      {body}
    </section>
  );
}
