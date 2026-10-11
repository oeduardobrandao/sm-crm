import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Edit2,
  Inbox,
  Lock,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { GroupedList } from '@/components/mobile/GroupedList';
import { InfoButton } from '@/components/mobile/InfoButton';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneFiltersSheet, type FilterSection } from '@/components/mobile/PhoneFiltersSheet';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PickerSheet } from '@/components/mobile/PickerSheet';
import { PhoneEntityRow } from '@/components/entity-list-phone/PhoneEntityRow';
import { PhoneListEmpty } from '@/components/entity-list-phone/PhoneListEmpty';
import { PhoneListSearch } from '@/components/entity-list-phone/PhoneListSearch';
import { PhoneUsageLine } from '@/components/entity-list-phone/PhoneUsageLine';
import { Badge } from '@/components/ui/badge';
import { CardListSkeleton } from '@/components/ui/skeletons';
import { AuthContext } from '@/context/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { reportPaywallHit } from '@/lib/paywall-report';
import type { Lead } from '@/store';
import { LEAD_STATUS_KEYS } from '../leadOptions';

export type LeadStatusFilter = 'todos' | Lead['status'];
export type LeadSortCol = 'nome' | 'email' | 'canal' | 'created_at';
type SortDir = 'asc' | 'desc';

const FEATURE_CSV = 'feature_csv_import';
const DEFAULT_SORT: LeadSortCol = 'created_at';
const DEFAULT_DIR: SortDir = 'desc';

export function leadStatusVariant(status: Lead['status']) {
  return status === 'convertido'
    ? 'success'
    : status === 'qualificado'
      ? 'primary'
      : status === 'novo'
        ? 'info'
        : status === 'perdido'
          ? 'danger'
          : 'neutral';
}

export interface LeadsPhoneProps {
  leads: Lead[];
  filtered: Lead[];
  isLoading: boolean;
  locale: string;
  search: string;
  onSearchChange: (value: string) => void;
  filterStatus: LeadStatusFilter;
  onFilterStatusChange: (value: LeadStatusFilter) => void;
  /** Free-form on the page (the desktop headers sort by more columns). */
  sortCol: string;
  onSortColChange: (value: string) => void;
  sortDir: SortDir;
  onSortDirChange: (value: SortDir) => void;
  canEdit: boolean;
  atLimit: boolean;
  /** Plan leads in use (the exact server count, list length as fallback). */
  used: number;
  /** Resolved plan limit for the usage line; `undefined` while it isn't known. */
  usageLimit: number | null | undefined;
  isOwner: boolean;
  onNew: () => void;
  onImport: () => void;
  onEdit: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: Lead['status']) => void;
}

/**
 * /leads on phones (FLeads mockup): large title with the plan usage, Buscar, Filtros
 * (sort) and the ink "+" (Novo / Importar CSV), status chips, then one grouped list. A
 * lead has no detail screen, so a tap opens the edit form; a hold opens Status ▸,
 * Converter em cliente, Editar and Remover; a swipe shows Converter, Mais and Remover.
 * State and every action belong to LeadsPage, shared with the desktop table.
 */
export function LeadsPhone(props: LeadsPhoneProps) {
  const {
    leads,
    filtered,
    isLoading,
    locale,
    search,
    onSearchChange,
    filterStatus,
    onFilterStatusChange,
    sortCol,
    onSortColChange,
    sortDir,
    onSortDirChange,
    canEdit,
    atLimit,
    used,
    usageLimit,
    isOwner,
    onNew,
    onImport,
    onEdit,
    onConvert,
    onDelete,
    onStatusChange,
  } = props;
  const { t } = useTranslation('leads');
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const { hasFeature } = useEntitlements();
  const workspaceId = useContext(AuthContext)?.profile?.conta_id ?? null;
  const csvLocked = !hasFeature(FEATURE_CSV);
  const listId = useId();

  const [searchOpen, setSearchOpen] = useState(() => search !== '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [statusLead, setStatusLead] = useState<Lead | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (addOpen && canEdit && csvLocked && workspaceId)
      reportPaywallHit({ workspaceId, feature: FEATURE_CSV });
  }, [addOpen, canEdit, csvLocked, workspaceId]);

  const sortLabels: Record<LeadSortCol, string> = {
    nome: tc('sort.name'),
    email: t('table.email'),
    canal: t('table.channel'),
    created_at: t('table.createdAt'),
  };
  const sortOptions = Object.keys(sortLabels) as LeadSortCol[];
  // The desktop headers can also sort by especialidade; name it if it got here.
  const sortLabel =
    sortCol in sortLabels
      ? sortLabels[sortCol as LeadSortCol]
      : sortCol === 'especialidade'
        ? t('table.specialty')
        : sortCol;

  const sortActive = sortCol !== DEFAULT_SORT || sortDir !== DEFAULT_DIR;
  const activeCount = sortActive ? 1 : 0;
  const filtersOrSearchActive = filterStatus !== 'todos' || search.trim() !== '';

  const filterSections: FilterSection[] = [
    {
      type: 'chips',
      key: 'sort',
      label: tc('filter.sortBy'),
      chips: sortOptions.map((s) => ({
        key: s,
        label: sortLabels[s],
        selected: sortCol === s,
        // Same as the desktop menu: picking a column sorts it ascending.
        onToggle: () => {
          onSortColChange(s);
          onSortDirChange('asc');
        },
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
      label: t('newLead'),
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

  const sortHeader = t('phone.sortedBy', { field: sortLabel.toLowerCase() });
  const statusChips: LeadStatusFilter[] = ['todos', ...LEAD_STATUS_KEYS];

  return (
    <div className="phone-leads">
      <PhonePageHeader
        title={t('title')}
        subtitle={
          usageLimit != null ? (
            <PhoneUsageLine label="leads" used={used} limit={usageLimit} showUpgradeCta={isOwner} />
          ) : isLoading || used === 0 ? undefined : (
            // Zero says nothing the empty state below doesn't (and pt plurals read "0 cliente").
            t('phone.count', { count: used })
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
        <ChipRow aria-label={tc('filter.status')} semantics="tablist" className="phone-el-chips">
          {statusChips.map((s) => (
            <Chip
              key={s}
              label={tc(`status.${s}`)}
              selected={filterStatus === s}
              controls={listId}
              onClick={() => onFilterStatusChange(s)}
            />
          ))}
        </ChipRow>
      </PhonePageHeader>

      <div id={listId} role="tabpanel" aria-label={tc(`status.${filterStatus}`)}>
        {isLoading ? (
          <CardListSkeleton />
        ) : filtered.length === 0 ? (
          leads.length === 0 ? (
            <PhoneListEmpty
              icon={<Inbox />}
              title={t('phone.emptyTitle')}
              description={canEdit ? t('phone.emptyText') : undefined}
              action={canEdit && !atLimit ? { label: t('newLead'), onClick: onNew } : undefined}
            />
          ) : (
            <PhoneListEmpty
              icon={<Search />}
              title={t('phone.emptyFilteredText')}
              action={
                filtersOrSearchActive
                  ? {
                      label: t('phone.clearFilters'),
                      onClick: () => {
                        onFilterStatusChange('todos');
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
            {filtered.map((l) => (
              <LeadRow
                key={l.id ?? l.nome}
                lead={l}
                locale={locale}
                canEdit={canEdit}
                onEdit={onEdit}
                onConvert={onConvert}
                onDelete={onDelete}
                onPickStatus={setStatusLead}
              />
            ))}
          </GroupedList>
        )}
      </div>

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Ordene os leads"
        sections={filterSections}
        activeCount={activeCount}
        onClear={() => {
          onSortColChange(DEFAULT_SORT);
          onSortDirChange(DEFAULT_DIR);
        }}
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

      {canEdit && (
        <PickerSheet<Lead['status']>
          open={statusLead !== null}
          onOpenChange={(open) => {
            if (!open) setStatusLead(null);
          }}
          title={t('form.status')}
          description={statusLead?.nome}
          options={LEAD_STATUS_KEYS.map((s) => ({ value: s, label: tc(`status.${s}`) }))}
          value={statusLead?.status ?? null}
          onChange={(status) => {
            if (statusLead?.id && status && status !== statusLead.status)
              onStatusChange(statusLead.id, status);
          }}
        />
      )}
    </div>
  );
}

function LeadRow({
  lead: l,
  locale,
  canEdit,
  onEdit,
  onConvert,
  onDelete,
  onPickStatus,
}: {
  lead: Lead;
  locale: string;
  canEdit: boolean;
  onEdit: (l: Lead) => void;
  onConvert: (l: Lead) => void;
  onDelete: (id: number) => void;
  onPickStatus: (l: Lead) => void;
}) {
  const { t } = useTranslation('leads');
  const { t: tc } = useTranslation();
  const meta = [
    l.instagram,
    l.canal,
    l.created_at ? new Date(l.created_at).toLocaleDateString(locale) : '',
  ].filter(Boolean);

  const content = (
    <>
      <span className="phone-el-text">
        <span className="phone-el-title">{l.nome}</span>
        {meta.length > 0 && (
          <span className="phone-el-subtitle">
            <span className="phone-el-subtitle__text">{meta.join(' · ')}</span>
          </span>
        )}
      </span>
      <Badge
        variant={leadStatusVariant(l.status)}
        size="sm"
        className="phone-el-badge"
        style={{ pointerEvents: 'none' }}
      >
        {tc(`status.${l.status}`)}
      </Badge>
    </>
  );

  if (!canEdit) {
    return (
      <PhoneEntityRow title={l.nome} menuLabel={t('phone.menuLabel')} menuSections={[]}>
        {content}
      </PhoneEntityRow>
    );
  }

  return (
    <PhoneEntityRow
      title={l.nome}
      onOpen={() => onEdit(l)}
      menuLabel={t('phone.menuLabel')}
      menuSections={[
        [
          {
            label: (
              <span className="phone-el-menu-status">
                <span>{t('form.status')}</span>
                <span className="phone-el-menu-status__value">{tc(`status.${l.status}`)}</span>
              </span>
            ),
            icon: <ChevronRight aria-hidden="true" />,
            onSelect: () => onPickStatus(l),
          },
          {
            label: t('convertToClient'),
            icon: <UserPlus aria-hidden="true" />,
            onSelect: () => onConvert(l),
          },
          {
            label: tc('actions.edit'),
            icon: <Edit2 aria-hidden="true" />,
            onSelect: () => onEdit(l),
          },
        ],
        l.id
          ? [
              {
                label: tc('actions.delete'),
                icon: <Trash2 aria-hidden="true" />,
                destructive: true,
                onSelect: () => onDelete(l.id!),
              },
            ]
          : [],
      ]}
      moreAction
      leadingActions={[
        {
          label: t('phone.convert'),
          icon: <UserPlus aria-hidden="true" />,
          tone: 'success',
          onAction: () => onConvert(l),
        },
      ]}
      trailingActions={
        l.id
          ? [
              {
                label: tc('actions.delete'),
                icon: <Trash2 aria-hidden="true" />,
                tone: 'destructive',
                onAction: () => onDelete(l.id!),
              },
            ]
          : []
      }
    >
      {content}
    </PhoneEntityRow>
  );
}
