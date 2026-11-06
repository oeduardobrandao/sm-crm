import { useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownUp,
  BarChart2,
  Check,
  ChevronRight,
  Plug,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { ListSkeleton } from '@/components/ui/skeletons';
import {
  getClientHealthMonitor,
  type ClientHealth,
  type ClientHealthSummary,
} from '../../../services/clientHealth';
import {
  filterAndSortClients,
  type HealthFilterKey,
  type HealthSort,
} from '../../../lib/health/filter';
import { HEALTH_TONE } from '../components/ClientHealthCard';
import { PipelineRow } from '../components/PipelineRow';
import { useClientHealthActions } from '../useClientHealthActions';
import { PhoneSection } from './PhoneSection';
import { ClienteFoto } from '@/components/ClienteFoto';
import { useCachedClienteFotoUrl } from '@/hooks/useClienteAvatars';

const EMPTY_SUMMARY: ClientHealthSummary = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

const CHIPS: { key: HealthFilterKey; countKey: keyof ClientHealthSummary }[] = [
  { key: 'todos', countKey: 'total' },
  { key: 'atencao', countKey: 'atencao' },
  { key: 'saudaveis', countKey: 'saudaveis' },
  { key: 'estaveis', countKey: 'estaveis' },
  { key: 'conexao', countKey: 'conexao' },
];

const SORTS: HealthSort[] = ['atencao', 'engajamento', 'ultimo_post', 'seguidores', 'nome'];

function Avatar({ c }: { c: ClientHealth }) {
  const fotoManual = useCachedClienteFotoUrl(c.client_id);
  return (
    <ClienteFoto
      srcs={[c.profile_picture_url, fotoManual]}
      className="phone-home-avatar"
      fallback={
        <span className="phone-home-avatar" style={{ background: c.client_cor }} aria-hidden="true">
          {c.client_sigla}
        </span>
      }
    />
  );
}

function StatusBadge({ c }: { c: ClientHealth }) {
  const { t } = useTranslation('dashboard');
  const tone = HEALTH_TONE[c.status];
  return (
    <span
      className="phone-home-badge phone-home-badge--health"
      style={{ '--tone-bg': tone.bg, '--tone-fg': tone.fg } as CSSProperties}
    >
      {t(`health.status.${c.status}`)}
    </span>
  );
}

/** Body of the client sheet: the desktop card's metrics and all its actions. */
function HealthDetail({ c }: { c: ClientHealth }) {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const navigate = useNavigate();
  const { closeThen } = useSheetActions();
  const { busy, handleConnect, handleSync } = useClientHealthActions(c);
  const isConnectState = c.status === 'desconectado';
  const isReconnectState = c.status === 'reconectar';
  const isStaleState = c.status === 'sem_sincronizar';
  const showMetrics = !isConnectState && !isReconnectState;
  const lastPost =
    c.days_since_last_post === null
      ? t('health.lastPost.never')
      : t('health.lastPost.days', { count: c.days_since_last_post });
  const delta =
    c.follower_delta !== 0
      ? ` ${c.follower_delta > 0 ? '▲' : '▼'}${Math.abs(c.follower_delta)}`
      : '';

  return (
    <div className="phone-home-sheet">
      <div className="phone-home-sheet__head">
        <Avatar c={c} />
        <div className="phone-home-sheet__who">
          {c.username && <span className="phone-home-row__context">@{c.username}</span>}
          <StatusBadge c={c} />
        </div>
      </div>
      {showMetrics ? (
        <>
          <GroupedList aria-label={t('health.title')}>
            <Cell
              label={t('health.metric.seguidores')}
              value={`${c.follower_count.toLocaleString(locale)}${delta}`}
            />
            <Cell label={t('health.metric.engajamento')} value={`${c.engagement_rate}%`} />
            <Cell label={t('health.metric.alcance')} value={c.reach_28d.toLocaleString(locale)} />
            <Cell label={t('health.metric.ultimoPost')} value={lastPost} />
          </GroupedList>
          <div className="phone-home-sheet__pipeline">
            <PipelineRow pipeline={c.pipeline} />
          </div>
        </>
      ) : (
        <p className="phone-home-sheet__note">
          {isReconnectState ? t('health.reconectarMsg') : t('health.empty.noneConnected')}
        </p>
      )}
      <GroupedList aria-label="Ações">
        {isConnectState && (
          <Cell
            icon={<Plug aria-hidden="true" />}
            label={t('health.cta.conectar')}
            disabled={busy}
            onClick={() => closeThen(() => void handleConnect())}
          />
        )}
        {isReconnectState && (
          <Cell
            icon={<Plug aria-hidden="true" />}
            label={t('health.cta.reconectar')}
            disabled={busy}
            onClick={() => closeThen(() => void handleConnect())}
          />
        )}
        {isStaleState && (
          <Cell
            icon={<RefreshCw aria-hidden="true" />}
            label={t('health.cta.sincronizar')}
            disabled={busy}
            onClick={() => void handleSync()}
          />
        )}
        <Cell
          icon={<BarChart2 aria-hidden="true" />}
          label={t('health.cta.analytics')}
          chevron
          onClick={() => closeThen(() => navigate(`/analytics/${c.client_id}`))}
        />
        <Cell
          icon={<User aria-hidden="true" />}
          label={t('health.cta.detalhe')}
          chevron
          onClick={() => closeThen(() => navigate(`/clientes/${c.client_id}`))}
        />
      </GroupedList>
    </div>
  );
}

/**
 * "Saúde dos clientes" on phones (FInicio): header with the counts and Buscar /
 * Ordenar, the five filters as chips, clients as grouped rows. A row opens a sheet with
 * the card's metrics and its actions (Conectar / Reconectar / Sincronizar, Analytics,
 * Detalhe).
 */
export function HealthPhone() {
  const { t } = useTranslation('dashboard');
  const [filter, setFilter] = useState<HealthFilterKey>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HealthSort>('atencao');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [aberto, setAberto] = useState<ClientHealth | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clientHealth'],
    queryFn: () => getClientHealthMonitor(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const clients = data?.clients ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;
  // Re-read the open client from fresh data (a sync updates its status).
  const atual = aberto ? (clients.find((c) => c.client_id === aberto.client_id) ?? aberto) : null;

  let note: string | null = null;
  if (isError) note = t('health.error');
  else if (!isLoading && clients.length === 0) note = t('health.empty.noClients');
  else if (!isLoading && !clients.some((c) => c.connected)) note = t('health.empty.noneConnected');
  const visible = note || isLoading ? [] : filterAndSortClients(clients, { filter, search, sort });
  if (!note && !isLoading && visible.length === 0) note = t('health.empty.filtered');

  return (
    <>
      <PhoneSection
        title={t('health.title')}
        subtitle={t('health.subtitle', {
          count: summary.total,
          total: summary.total,
          attention: summary.precisamAtencao,
        })}
        data-testid="health-phone"
        trailing={
          <>
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : t('health.search')}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  setSearch('');
                  setSearchOpen(false);
                } else {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }
              }}
            >
              {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
            </PhoneIconButton>
            <PhoneIconButton
              label={`${t('health.sortLabel')}: ${t(`health.sort.${sort}`)}`}
              aria-haspopup="dialog"
              onClick={() => setSortOpen(true)}
            >
              <ArrowDownUp aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
        toolbar={
          <>
            {searchOpen && (
              <div className="phone-home-search">
                <Search aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  enterKeyHint="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('health.search')}
                  aria-label={t('health.search')}
                />
              </div>
            )}
            <ChipRow aria-label={t('health.title')} className="phone-home-chips">
              {CHIPS.map(({ key, countKey }) => (
                <Chip
                  key={key}
                  label={t(`health.chips.${key}`)}
                  count={summary[countKey]}
                  selected={filter === key}
                  onClick={() => setFilter(key)}
                />
              ))}
            </ChipRow>
          </>
        }
      >
        {isLoading && (
          <li className="phone-home-row phone-home-row--pad">
            <ListSkeleton rows={3} avatar />
          </li>
        )}
        {note && (
          <li className="phone-home-row phone-home-row--pad">
            <span className="phone-home-empty">{note}</span>
          </li>
        )}
        {visible.map((c) => {
          const detail =
            c.status === 'reconectar' || c.status === 'desconectado'
              ? null
              : c.days_since_last_post === null
                ? t('health.lastPost.never')
                : `${t('health.metric.ultimoPost')} ${t('health.lastPost.days', { count: c.days_since_last_post })}`;
          return (
            <li key={c.client_id} className="phone-home-row">
              <button
                type="button"
                className="phone-home-row__link"
                aria-haspopup="dialog"
                onClick={() => {
                  setAberto(c);
                  setSheetOpen(true);
                }}
              >
                <Avatar c={c} />
                <span className="phone-home-row__text">
                  <span className="phone-home-row__title">{c.client_name}</span>
                  <span className="phone-home-row__context">
                    {[c.username ? `@${c.username}` : null, detail].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <StatusBadge c={c} />
                <ChevronRight className="phone-home-row__chevron" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </PhoneSection>

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('health.sortLabel')}
        actions={SORTS.map((s) => ({
          label: t(`health.sort.${s}`),
          icon: sort === s ? <Check aria-hidden="true" /> : undefined,
          onSelect: () => setSort(s),
        }))}
      />

      {atual && (
        <BottomSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={atual.client_name}
          detents={['medium', 'large']}
        >
          <HealthDetail c={atual} />
        </BottomSheet>
      )}
    </>
  );
}
