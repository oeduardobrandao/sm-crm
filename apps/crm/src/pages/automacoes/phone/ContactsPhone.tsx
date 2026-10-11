import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { Download, MoreHorizontal, Search, SlidersHorizontal } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneFiltersSheet } from '@/components/mobile/PhoneFiltersSheet';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { CardListSkeleton } from '@/components/ui/skeletons';
import type { ContactAutomationCount, ContactFilters, InstagramContact } from '@/store';
import { instagramProfileUrl } from '../contacts/profileUrl';
import { Pill } from './Pill';
import './automacoesPhone.css';

export interface ContactsPhoneProps {
  filters: ContactFilters;
  setFilters: (patch: Partial<ContactFilters>) => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  clientOptions: { id?: number | null; nome: string }[];
  automationOptions: ContactAutomationCount[];
  clientesById: Map<number, string>;
  range: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  rows: InstagramContact[];
  total: number;
  from: number;
  to: number;
  page: number;
  setPage: (page: number) => void;
  /** Copy for an empty list, already picked by the tab (none yet / none reached / filtered). */
  emptyText: string;
  exporting: boolean;
  onExport: () => void;
}

function fmt(iso: string, lang: string) {
  return format(new Date(iso), "dd MMM yyyy '·' HH:mm", {
    locale: lang.startsWith('en') ? enUS : ptBR,
  });
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Contatos below 768px: search field, a filters sheet (cliente, automação, a
 * single-month period picker, "só quem recebeu DM"), removable chips for what's
 * active, Exportar CSV behind "…", grouped rows and the same paging. Pure render: the
 * tab owns the URL-backed filters, the queries and the export.
 */
export function ContactsPhone({
  filters,
  setFilters,
  searchInput,
  onSearchInput,
  clientOptions,
  automationOptions,
  clientesById,
  range,
  onRangeChange,
  isPending,
  isError,
  onRetry,
  rows,
  total,
  from,
  to,
  page,
  setPage,
  emptyText,
  exporting,
  onExport,
}: ContactsPhoneProps) {
  const { t, i18n } = useTranslation('automations');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const automationLabel = (a: { automation_name: string | null; automation_deleted: boolean }) =>
    !a.automation_name
      ? ''
      : a.automation_deleted
        ? t('contacts.removed', { name: a.automation_name })
        : a.automation_name;

  const selectedAutomation = filters.automationId
    ? automationOptions.find((a) => a.automation_id === filters.automationId)
    : undefined;
  const periodLabel = filters.from
    ? filters.to && filters.to !== filters.from
      ? `${format(new Date(`${filters.from}T00:00:00`), 'dd/MM/yyyy')} – ${format(
          new Date(`${filters.to}T00:00:00`),
          'dd/MM/yyyy',
        )}`
      : format(new Date(`${filters.from}T00:00:00`), 'dd/MM/yyyy')
    : null;

  const activeCount =
    (filters.clientId != null ? 1 : 0) +
    (filters.automationId != null ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.reachedOnly ? 0 : 1);

  return (
    <div className="phone-auto-contacts">
      <p className="phone-auto__hint phone-auto-contacts__intro">{t('contacts.intro')}</p>

      <div className="phone-auto-contacts__toolbar">
        <label className="phone-auto-contacts__search">
          <Search aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder={t('contacts.searchPlaceholder')}
            aria-label={t('contacts.searchPlaceholder')}
          />
        </label>
        <PhoneIconButton
          label={t('phone.filters')}
          badge={activeCount}
          aria-haspopup="dialog"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" />
        </PhoneIconButton>
        <PhoneIconButton
          label={t('phone.moreActions')}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal aria-hidden="true" />
        </PhoneIconButton>
      </div>

      {activeCount > 0 && (
        <ChipRow aria-label={t('phone.filters')} className="phone-auto__chips">
          {filters.clientId != null && (
            <Chip
              label={clientesById.get(filters.clientId) ?? t('contacts.filterClient')}
              removeLabel={`${t('contacts.filterClient')}: ${clientesById.get(filters.clientId) ?? ''}`}
              onRemove={() => setFilters({ clientId: null })}
            />
          )}
          {selectedAutomation && (
            <Chip
              label={automationLabel(selectedAutomation)}
              removeLabel={`${t('contacts.filterAutomation')}: ${automationLabel(selectedAutomation)}`}
              onRemove={() => setFilters({ automationId: null })}
            />
          )}
          {periodLabel && (
            <Chip
              label={periodLabel}
              removeLabel={t('phone.periodClear')}
              onRemove={() => setFilters({ from: null, to: null })}
            />
          )}
          {!filters.reachedOnly && (
            <Chip
              label={t('phone.showAllContacts')}
              removeLabel={t('contacts.reachedOnly')}
              onRemove={() => setFilters({ reachedOnly: true })}
            />
          )}
        </ChipRow>
      )}

      {isPending ? (
        <CardListSkeleton rows={4} />
      ) : isError ? (
        <div className="phone-auto-contacts__state">
          <p>{t('contacts.loadError')}</p>
          <Button variant="outline" onClick={onRetry}>
            {t('contacts.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="phone-auto__empty">{emptyText}</p>
      ) : (
        <>
          <GroupedList aria-label={t('contacts.tabContacts')}>
            {rows.map((r) => {
              const url = instagramProfileUrl(r.commenter_username);
              const showClient = filters.clientId == null;
              const sub = [
                showClient ? (clientesById.get(r.client_id) ?? '') : '',
                automationLabel(r),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={r.id} className="phone-cell phone-auto-li">
                  <div className="phone-auto-contact">
                    <div className="phone-auto-contact__top">
                      {!r.commenter_username ? (
                        <span className="phone-auto-contact__user phone-auto-contact__user--muted">
                          {t('contacts.unknownUser')}
                        </span>
                      ) : url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="phone-auto-contact__user"
                        >
                          @{r.commenter_username}
                        </a>
                      ) : (
                        <span className="phone-auto-contact__user">@{r.commenter_username}</span>
                      )}
                      <Pill tone={r.reached ? 'success' : 'neutral'}>
                        {t('contacts.col.reached')}:{' '}
                        {r.reached ? t('contacts.yes') : t('contacts.no')}
                      </Pill>
                    </div>
                    {sub && <span className="phone-auto-contact__meta">{sub}</span>}
                    <span className="phone-auto-contact__meta">
                      {t('contacts.col.interactions')}: {r.interactions_count} ·{' '}
                      {fmt(r.last_interaction_at, i18n.language)}
                    </span>
                    {r.last_comment_text && (
                      <span className="phone-auto-contact__comment">
                        “{truncate(r.last_comment_text, 80)}”
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </GroupedList>
          <div className="phone-auto-contacts__paging">
            <span>{t('contacts.showing', { from, to, total })}</span>
            <span className="phone-auto-contacts__paging-buttons">
              <button
                type="button"
                className="phone-text-button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('contacts.prev')}
              </button>
              <button
                type="button"
                className="phone-text-button phone-text-button--strong"
                disabled={to >= total}
                onClick={() => setPage(page + 1)}
              >
                {t('contacts.next')}
              </button>
            </span>
          </div>
        </>
      )}

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={t('phone.filters')}
        activeCount={activeCount}
        resultCount={total}
        onClear={() =>
          setFilters({
            clientId: null,
            automationId: null,
            from: null,
            to: null,
            reachedOnly: true,
          })
        }
        sections={[
          {
            type: 'custom',
            key: 'pickers',
            content: (
              <GroupedList>
                <PickerCell<number>
                  label={t('contacts.filterClient')}
                  options={clientOptions
                    .filter((c) => c.id != null)
                    .map((c) => ({ value: c.id as number, label: c.nome }))}
                  emptyOption={{ label: t('contacts.allClients') }}
                  value={filters.clientId}
                  onChange={(v) => setFilters({ clientId: v })}
                />
                <PickerCell<string>
                  label={t('contacts.filterAutomation')}
                  options={automationOptions.map((a) => ({
                    value: a.automation_id,
                    label: automationLabel(a),
                  }))}
                  emptyOption={{ label: t('contacts.allAutomations') }}
                  value={filters.automationId}
                  onChange={(v) => setFilters({ automationId: v })}
                />
              </GroupedList>
            ),
          },
          {
            type: 'custom',
            key: 'period',
            content: (
              <GroupedList header={t('contacts.filterPeriod')}>
                <li className="phone-cell phone-auto-li">
                  <div className="phone-auto-contacts__period">
                    <DateRangePicker
                      value={range}
                      placeholder={t('contacts.filterPeriod')}
                      numberOfMonths={1}
                      onChange={onRangeChange}
                      className="phone-auto-contacts__period-button"
                    />
                  </div>
                </li>
              </GroupedList>
            ),
          },
          {
            type: 'custom',
            key: 'reached',
            content: (
              <GroupedList>
                <Cell
                  label={t('contacts.reachedOnly')}
                  switch={{
                    checked: filters.reachedOnly,
                    onCheckedChange: (v) => setFilters({ reachedOnly: v }),
                  }}
                />
              </GroupedList>
            ),
          },
        ]}
      />

      <ActionSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t('contacts.tabContacts')}
        hideTitle
        cancelLabel={t('cancel')}
        actions={[
          {
            label: exporting ? t('contacts.exporting') : t('contacts.export'),
            icon: <Download aria-hidden="true" />,
            disabled: exporting || total === 0,
            onSelect: onExport,
          },
        ]}
      />
    </div>
  );
}
