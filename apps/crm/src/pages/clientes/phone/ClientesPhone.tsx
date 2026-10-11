import { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Edit2,
  ExternalLink,
  Lock,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { GroupedList } from '@/components/mobile/GroupedList';
import { InfoButton } from '@/components/mobile/InfoButton';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneFiltersSheet, type FilterSection } from '@/components/mobile/PhoneFiltersSheet';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import type { ContextMenuAction } from '@/components/mobile/ContextMenu';
import type { SwipeAction } from '@/components/mobile/SwipeRow';
import { PhoneEntityRow } from '@/components/entity-list-phone/PhoneEntityRow';
import { PhoneListEmpty } from '@/components/entity-list-phone/PhoneListEmpty';
import { PhoneListSearch } from '@/components/entity-list-phone/PhoneListSearch';
import { PhoneUsageLine } from '@/components/entity-list-phone/PhoneUsageLine';
import { Badge } from '@/components/ui/badge';
import { CardListSkeleton } from '@/components/ui/skeletons';
import { AuthContext } from '@/context/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { reportPaywallHit } from '@/lib/paywall-report';
import { sanitizeUrl } from '@/utils/security';
import { getInitials, type Cliente } from '@/store';

export type ClienteFilterStatus = 'todos' | 'ativo' | 'pausado' | 'encerrado';
export type ClienteSortBy = 'nome' | 'valor_mensal' | 'data_pagamento';
export type SortDir = 'asc' | 'desc';

export interface ClientesPhoneProps {
  clientes: Cliente[];
  filtered: Cliente[];
  isLoading: boolean;
  avatarMap: Record<number, string>;
  search: string;
  onSearchChange: (value: string) => void;
  filter: ClienteFilterStatus;
  onFilterChange: (value: ClienteFilterStatus) => void;
  sortBy: ClienteSortBy;
  onSortByChange: (value: ClienteSortBy) => void;
  sortDir: SortDir;
  onSortDirChange: (value: SortDir) => void;
  canEdit: boolean;
  canSeeFinancials: boolean | 'unknown';
  atLimit: boolean;
  /** Resolved plan limit for the usage line; `undefined` while it isn't known. */
  usageLimit: number | null | undefined;
  isOwner: boolean;
  onNew: () => void;
  onImport: () => void;
  onEdit: (cliente: Cliente) => void;
  onDelete: (id: number) => void;
}

const STATUS_KEYS: ClienteFilterStatus[] = ['todos', 'ativo', 'pausado', 'encerrado'];
const FEATURE_CSV = 'feature_csv_import';

function statusVariant(status: Cliente['status']) {
  return status === 'ativo' ? 'success' : status === 'pausado' ? 'warning' : 'neutral';
}

/**
 * /clientes on phones (FClientes mockup): large title with the plan usage, Buscar,
 * Filtros and the ink "+" (Novo / Importar CSV), then one grouped list of clients. A
 * row opens the client; a hold opens Notion / Editar / Remover; a swipe shows the same.
 * State and every action belong to ClientesPage, shared with the desktop table.
 */
export function ClientesPhone(props: ClientesPhoneProps) {
  const {
    clientes,
    filtered,
    isLoading,
    avatarMap,
    search,
    onSearchChange,
    filter,
    onFilterChange,
    sortBy,
    onSortByChange,
    sortDir,
    onSortDirChange,
    canEdit,
    canSeeFinancials,
    atLimit,
    usageLimit,
    isOwner,
    onNew,
    onImport,
    onEdit,
    onDelete,
  } = props;
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const { hasFeature } = useEntitlements();
  // As FeatureGate does: read the context, not useAuth, so this works outside a provider.
  const workspaceId = useContext(AuthContext)?.profile?.conta_id ?? null;
  const csvLocked = !hasFeature(FEATURE_CSV);

  const [searchOpen, setSearchOpen] = useState(() => search !== '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  // FeatureGate reports a paywall hit when it renders locked; on phones the gated
  // import lives in the "+" sheet, so report when that sheet shows it locked.
  useEffect(() => {
    if (addOpen && canEdit && csvLocked && workspaceId)
      reportPaywallHit({ workspaceId, feature: FEATURE_CSV });
  }, [addOpen, canEdit, csvLocked, workspaceId]);

  const sortLabels: Record<ClienteSortBy, string> = {
    nome: tc('sort.name'),
    valor_mensal: t('sort.monthlyValue'),
    data_pagamento: t('sort.paymentDay'),
  };
  const sortOptions: ClienteSortBy[] =
    canSeeFinancials === true
      ? ['nome', 'valor_mensal', 'data_pagamento']
      : ['nome', 'data_pagamento'];

  const sortActive = sortBy !== 'nome' || sortDir !== 'asc';
  const activeCount = (filter !== 'todos' ? 1 : 0) + (sortActive ? 1 : 0);
  const clearFilters = () => {
    onFilterChange('todos');
    onSortByChange('nome');
    onSortDirChange('asc');
  };
  const filtersOrSearchActive = filter !== 'todos' || search.trim() !== '';

  const filterSections: FilterSection[] = [
    {
      type: 'chips',
      key: 'status',
      label: tc('filter.status'),
      chips: STATUS_KEYS.map((s) => ({
        key: s,
        label: tc(`status.${s}`),
        selected: filter === s,
        onToggle: () => onFilterChange(s),
      })),
    },
    {
      type: 'chips',
      key: 'sort',
      label: tc('filter.sortBy'),
      chips: sortOptions.map((s) => ({
        key: s,
        label: sortLabels[s],
        selected: sortBy === s,
        onToggle: () => onSortByChange(s),
      })),
    },
    {
      type: 'chips',
      key: 'dir',
      label: 'Ordem',
      chips: (['asc', 'desc'] as SortDir[]).map((d) => ({
        key: d,
        label: d === 'asc' ? tc('sort.ascending') : tc('sort.descending'),
        selected: sortDir === d,
        onToggle: () => onSortDirChange(d),
      })),
    },
  ];

  const addActions: ActionSheetAction[] = [
    {
      label: t('newClient'),
      icon: <UserPlus aria-hidden="true" />,
      disabled: atLimit,
      onSelect: onNew,
    },
    csvLocked
      ? {
          label: tc('actions.importCsv'),
          icon: <Lock aria-hidden="true" />,
          onSelect: () => {
            if (workspaceId)
              reportPaywallHit({ workspaceId, feature: FEATURE_CSV, clickedUpgrade: true });
            navigate('/configuracao/cobranca');
          },
        }
      : {
          label: tc('actions.importCsv'),
          icon: <Upload aria-hidden="true" />,
          // The file picker needs the tap itself (iOS drops a deferred input.click()).
          immediate: true,
          onSelect: onImport,
        },
  ];

  const addMessage = (
    <>
      {atLimit && <span className="block">Limite do plano atingido.</span>}
      {csvLocked ? (
        <span className="block">Importação CSV não está disponível no seu plano.</span>
      ) : (
        <span className="block">{t('csvTooltip')}</span>
      )}
    </>
  );

  const sortHeader = t('phone.sortedBy', { field: sortLabels[sortBy].toLowerCase() });

  return (
    <div className="phone-clientes">
      <PhonePageHeader
        title={t('title')}
        subtitle={
          usageLimit != null ? (
            <PhoneUsageLine
              label="clientes"
              used={clientes.length}
              limit={usageLimit}
              showUpgradeCta={isOwner}
            />
          ) : isLoading || clientes.length === 0 ? undefined : (
            // Zero says nothing the empty state below doesn't (and pt plurals read "0 cliente").
            t('phone.count', { count: clientes.length })
          )
        }
        actions={
          <>
            <InfoButton
              title={t('title')}
              content={
                <>
                  <p>{t('tooltip')}</p>
                  {canEdit && <p>{t('csvTooltip')}</p>}
                </>
              }
            />
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : tc('actions.search')}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  onSearchChange('');
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
              ref={filtersRef}
              label={activeCount > 0 ? `Filtros, ${activeCount} ativos` : 'Filtros'}
              badge={activeCount}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {canEdit && (
              <PhoneIconButton
                ref={addRef}
                label={t('phone.addMenu')}
                variant="ink"
                aria-haspopup="dialog"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        {searchOpen && (
          <PhoneListSearch
            ref={searchRef}
            value={search}
            onChange={onSearchChange}
            placeholder={t('searchPlaceholder')}
          />
        )}
      </PhonePageHeader>

      {isLoading ? (
        <CardListSkeleton />
      ) : filtered.length === 0 ? (
        clientes.length === 0 ? (
          <PhoneListEmpty
            icon={<Users />}
            title={t('phone.emptyTitle')}
            description={
              canEdit ? t('phone.emptyText') : t('emptyList', 'Nenhum cliente encontrado.')
            }
            action={canEdit && !atLimit ? { label: t('newClient'), onClick: onNew } : undefined}
          />
        ) : (
          <PhoneListEmpty
            icon={<Search />}
            title={t('emptyList', 'Nenhum cliente encontrado.')}
            description={t('phone.emptyFilteredText')}
            action={
              filtersOrSearchActive
                ? {
                    label: t('phone.clearFilters'),
                    onClick: () => {
                      onFilterChange('todos');
                      onSearchChange('');
                      setSearchOpen(false);
                    },
                  }
                : undefined
            }
          />
        )
      ) : (
        <GroupedList
          header={sortDir === 'desc' ? `${sortHeader} · ${tc('sort.descending')}` : sortHeader}
          footer={canEdit ? t('phone.holdHint') : undefined}
        >
          {filtered.map((c) => (
            <ClienteRow
              key={c.id ?? c.nome}
              cliente={c}
              avatarUrl={c.id ? avatarMap[c.id] : undefined}
              canEdit={canEdit}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </GroupedList>
      )}

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Filtre e ordene os clientes"
        sections={filterSections}
        activeCount={activeCount}
        onClear={clearFilters}
        resultCount={filtered.length}
        returnFocusRef={filtersRef}
      />

      {canEdit && (
        <ActionSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          title={t('phone.addMenu')}
          hideTitle
          message={addMessage}
          actions={addActions}
          returnFocusRef={addRef}
        />
      )}
    </div>
  );
}

function ClienteRow({
  cliente: c,
  avatarUrl,
  canEdit,
  onEdit,
  onDelete,
}: {
  cliente: Cliente;
  avatarUrl?: string;
  canEdit: boolean;
  onEdit: (c: Cliente) => void;
  onDelete: (id: number) => void;
}) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const initials = getInitials(c.nome);
  const notionUrl = c.notion_page_url ? sanitizeUrl(c.notion_page_url) : '';
  const openNotion = () => window.open(notionUrl, '_blank', 'noopener,noreferrer');

  const notionMenu: ContextMenuAction[] = notionUrl
    ? [
        {
          label: t('openNotion'),
          icon: <ExternalLink aria-hidden="true" />,
          immediate: true,
          onSelect: openNotion,
        },
      ]
    : [];
  const editMenu: ContextMenuAction[] = canEdit
    ? [{ label: tc('actions.edit'), icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(c) }]
    : [];
  const deleteMenu: ContextMenuAction[] =
    canEdit && c.id
      ? [
          {
            label: tc('actions.delete'),
            icon: <Trash2 aria-hidden="true" />,
            destructive: true,
            onSelect: () => onDelete(c.id!),
          },
        ]
      : [];

  const leading: SwipeAction[] = notionUrl
    ? [
        {
          label: t('phone.notion'),
          icon: <ExternalLink aria-hidden="true" />,
          tone: 'ink',
          onAction: openNotion,
        },
      ]
    : [];
  const trailing: SwipeAction[] = [
    ...(canEdit
      ? [
          {
            label: tc('actions.edit'),
            icon: <Edit2 aria-hidden="true" />,
            tone: 'neutral' as const,
            onAction: () => onEdit(c),
          },
        ]
      : []),
    ...(canEdit && c.id
      ? [
          {
            label: tc('actions.delete'),
            icon: <Trash2 aria-hidden="true" />,
            tone: 'destructive' as const,
            onAction: () => onDelete(c.id!),
          },
        ]
      : []),
  ];

  return (
    <PhoneEntityRow
      title={c.nome}
      to={c.id ? `/clientes/${c.id}` : undefined}
      menuLabel={t('phone.menuLabel')}
      menuSections={[[...notionMenu, ...editMenu], deleteMenu]}
      leadingActions={leading}
      trailingActions={trailing}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={initials} className="phone-el-avatar" />
      ) : (
        <span className="phone-el-avatar" style={{ background: c.cor }} aria-hidden="true">
          {initials}
        </span>
      )}
      <span className="phone-el-text">
        <span className="phone-el-title">{c.nome}</span>
        <span className="phone-el-subtitle">
          {c.plano && (
            <>
              <span className="phone-el-subtitle__text">{c.plano}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <Badge
            variant={statusVariant(c.status)}
            size="sm"
            className="phone-el-badge"
            style={{ pointerEvents: 'none' }}
          >
            {tc(`status.${c.status}`)}
          </Badge>
        </span>
      </span>
    </PhoneEntityRow>
  );
}
