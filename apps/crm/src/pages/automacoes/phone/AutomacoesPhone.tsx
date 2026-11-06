import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { ChipRow, Chip } from '@/components/mobile/ChipRow';
import { GroupedList } from '@/components/mobile/GroupedList';
import { PickerSheet } from '@/components/mobile/PickerSheet';
import { SwipeRow } from '@/components/mobile/SwipeRow';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import { CardListSkeleton } from '@/components/ui/skeletons';
import type { Cliente, InstagramAutomationSend, InstagramCommentAutomation } from '../../../store';
import type { AutomacoesTab } from '../contacts/useContactsFilters';
import { AutomationDetailSheet } from './AutomationDetailSheet';
import { shortDate, targetSummary } from './phoneFormat';
import { Pill } from './Pill';
import './automacoesPhone.css';

type Automation = InstagramCommentAutomation;

export interface AutomacoesPhoneProps {
  /** Active automations across every client (the "N ativas" subtitle). */
  activeCount: number;
  /** The page's gated "+" (FeatureGate around the ink button), or null. */
  createAction: ReactNode;
  /** The FeatureGate upgrade nudge when the plan lacks the feature, or null. */
  lockedNotice: ReactNode;
  tab: AutomacoesTab;
  onTabChange: (tab: AutomacoesTab) => void;
  /** The Contatos panel (ContactsTab). */
  contacts: ReactNode;
  /** The onboarding checklist ("Comece por aqui"), or null. */
  checklist: ReactNode;
  clientOptions: Cliente[];
  clientFilter: number | 'todos';
  onClientFilterChange: (value: number | 'todos') => void;
  isLoading: boolean;
  /** The list after the cliente filter. */
  automations: Automation[];
  /** Whether the workspace has any automation at all (picks the empty-state copy). */
  hasAny: boolean;
  clientesById: Map<number, Cliente>;
  /** `can('automacoes', 'editar') === true`: gates the re-target action. */
  canEdit: boolean;
  detailId: string | null;
  onOpenDetail: (id: string | null) => void;
  sends: InstagramAutomationSend[] | undefined;
  sendsLoading: boolean;
  sendsError: boolean;
  reachedByAutomation: Map<string, number>;
  formatDateTime: (iso: string) => string;
  onToggle: (automation: Automation, ativo: boolean) => void;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRetarget: (automation: Automation) => void;
  onViewContacts: (automation: Automation) => void;
}

const PANEL_ID = 'automacoes-phone-panel';

/**
 * /automacoes below 768px (FAutomacoes mockup): page header with the gated "+",
 * Automações / Contatos as a segmented control, the cliente filter as a chip, and the
 * automations as grouped rows with the ativo switch, swipe and long-press actions and
 * a detail sheet. Pure render: the page owns every query, mutation and overlay state.
 */
export function AutomacoesPhone(props: AutomacoesPhoneProps) {
  const { t } = useTranslation('automations');
  const {
    activeCount,
    createAction,
    lockedNotice,
    tab,
    onTabChange,
    contacts,
    checklist,
    clientOptions,
    clientFilter,
    onClientFilterChange,
    isLoading,
    automations,
    hasAny,
    clientesById,
    canEdit,
    detailId,
    onOpenDetail,
  } = props;
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const clienteNome = (a: Automation) => clientesById.get(a.client_id)?.nome ?? t('clientRemoved');
  const selectedClient =
    clientFilter === 'todos' ? null : (clientesById.get(clientFilter)?.nome ?? null);
  const detail = detailId ? (automations.find((a) => a.id === detailId) ?? null) : null;

  return (
    <div className="phone-auto">
      <PhonePageHeader
        title={t('title')}
        subtitle={t('phone.activeCount', { count: activeCount })}
        actions={createAction}
      >
        {lockedNotice && <div className="phone-auto__locked">{lockedNotice}</div>}
        <SegmentedControl
          semantics="tablist"
          aria-label={t('phone.sectionsAria')}
          className="phone-auto__segments"
          value={tab}
          onChange={onTabChange}
          options={[
            {
              value: 'automacoes',
              label: t('contacts.tabAutomations'),
              id: 'automacoes-phone-tab-automacoes',
              controls: PANEL_ID,
            },
            {
              value: 'contatos',
              label: t('contacts.tabContacts'),
              id: 'automacoes-phone-tab-contatos',
              controls: PANEL_ID,
            },
          ]}
        />
      </PhonePageHeader>

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`automacoes-phone-tab-${tab}`}
        className="phone-auto__panel"
      >
        {tab === 'contatos' ? (
          contacts
        ) : (
          <>
            {checklist && <div className="phone-auto__checklist">{checklist}</div>}

            {clientOptions.length > 0 && (
              <ChipRow aria-label={t('filterByClient')} className="phone-auto__chips">
                <Chip
                  label={t('phone.clientChip', { name: selectedClient ?? t('phone.allShort') })}
                  selected={clientFilter !== 'todos'}
                  onClick={() => setClientPickerOpen(true)}
                />
              </ChipRow>
            )}

            {isLoading ? (
              <CardListSkeleton rows={4} />
            ) : automations.length === 0 ? (
              <>
                <p className="phone-auto__empty">{hasAny ? t('emptyForClient') : t('emptyNone')}</p>
                <p className="phone-auto__hint">{t('tiebreakHint')}</p>
              </>
            ) : (
              <GroupedList aria-label={t('title')} footer={t('tiebreakHint')}>
                {automations.map((a) => (
                  <AutomationPhoneRow
                    key={a.id}
                    automation={a}
                    clienteNome={clienteNome(a)}
                    canEdit={canEdit}
                    onOpen={() => onOpenDetail(a.id)}
                    onToggle={props.onToggle}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                    onRetarget={props.onRetarget}
                  />
                ))}
              </GroupedList>
            )}
          </>
        )}
      </div>

      {clientOptions.length > 0 && (
        <PickerSheet<number>
          open={clientPickerOpen}
          onOpenChange={setClientPickerOpen}
          title={t('filterByClient')}
          emptyOption={{ label: t('allClients') }}
          options={clientOptions.map((c) => ({ value: c.id as number, label: c.nome }))}
          value={clientFilter === 'todos' ? null : clientFilter}
          onChange={(v) => onClientFilterChange(v ?? 'todos')}
        />
      )}

      <AutomationDetailSheet
        automation={detail}
        onClose={() => onOpenDetail(null)}
        clienteNome={detail ? clienteNome(detail) : ''}
        canEdit={canEdit}
        reachedCount={detail ? (props.reachedByAutomation.get(detail.id) ?? 0) : 0}
        sends={props.sends}
        sendsLoading={props.sendsLoading}
        sendsError={props.sendsError}
        formatDateTime={props.formatDateTime}
        onToggle={props.onToggle}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onRetarget={props.onRetarget}
        onViewContacts={props.onViewContacts}
      />
    </div>
  );
}

interface RowProps {
  automation: Automation;
  clienteNome: string;
  canEdit: boolean;
  onOpen: () => void;
  onToggle: (automation: Automation, ativo: boolean) => void;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRetarget: (automation: Automation) => void;
}

/**
 * One automation: tap opens the detail sheet, the switch toggles ativo, swiping left
 * shows Editar / Excluir and a long press opens the same actions as a menu. The switch
 * sits outside the hold target, so holding it never opens the menu (one owner per hold).
 */
function AutomationPhoneRow({
  automation: a,
  clienteNome,
  canEdit,
  onOpen,
  onToggle,
  onEdit,
  onDelete,
  onRetarget,
}: RowProps) {
  const { t } = useTranslation('automations');
  const target = targetSummary(a, t);

  const open: ContextMenuAction[] = [
    { label: t('edit'), icon: <Pencil aria-hidden="true" />, onSelect: () => onEdit(a) },
  ];
  if (target.unlinked && canEdit)
    open.push({
      label: t('unlinkedTargetAction'),
      icon: <Instagram aria-hidden="true" />,
      onSelect: () => onRetarget(a),
    });
  const danger: ContextMenuAction[] = [
    {
      label: t('delete'),
      icon: <Trash2 aria-hidden="true" />,
      destructive: true,
      onSelect: () => onDelete(a),
    },
  ];

  return (
    <SwipeRow
      as="li"
      className="phone-auto-row"
      trailingActions={[
        {
          label: t('edit'),
          icon: <Pencil aria-hidden="true" />,
          tone: 'neutral',
          onAction: () => onEdit(a),
        },
        {
          label: t('delete'),
          icon: <Trash2 aria-hidden="true" />,
          tone: 'destructive',
          onAction: () => onDelete(a),
        },
      ]}
    >
      <div className="phone-auto-row__inner">
        <ContextMenu
          label={t('rowActions', { name: a.name })}
          sections={[open, danger]}
          className="phone-auto-row__hold"
          preview={
            <div className="phone-auto-row__preview">
              <RowBody automation={a} clienteNome={clienteNome} />
            </div>
          }
        >
          {({ triggerProps }) => (
            <RowMain
              automation={a}
              clienteNome={clienteNome}
              onOpen={onOpen}
              triggerProps={triggerProps}
            />
          )}
        </ContextMenu>
        <button
          type="button"
          role="switch"
          aria-checked={a.ativo}
          aria-label={a.ativo ? t('switchDeactivate') : t('switchActivate')}
          className="phone-switch phone-auto-row__switch"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(a, !a.ativo);
          }}
        >
          <span className="phone-switch__thumb" aria-hidden="true" />
        </button>
      </div>
    </SwipeRow>
  );
}

function RowMain({
  automation: a,
  clienteNome,
  onOpen,
  triggerProps,
}: {
  automation: Automation;
  clienteNome: string;
  onOpen: () => void;
  triggerProps: ContextMenuTriggerProps;
}) {
  const { t } = useTranslation('automations');
  return (
    <>
      <button
        type="button"
        className="phone-auto-row__main"
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <RowBody automation={a} clienteNome={clienteNome} />
      </button>
      {/* The menu's explicit trigger, for keyboard and screen readers: hidden until
          focused, since the long press and the swipe actions cover touch. */}
      <button
        {...triggerProps}
        className="phone-auto-row__more"
        aria-label={t('rowActions', { name: a.name })}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
    </>
  );
}

function RowBody({ automation: a, clienteNome }: { automation: Automation; clienteNome: string }) {
  const { t } = useTranslation('automations');
  const target = targetSummary(a, t);
  const buttons = (a.dm_buttons ?? []).length;
  const subtitle = target.text ? `${clienteNome} · ${target.text}` : clienteNome;
  const hasPills = a.keywords.length > 0 || buttons > 0 || a.dm_media || target.badge;
  return (
    <span className="phone-auto-row__body">
      <strong className="phone-auto-row__title">{a.name}</strong>
      <span className="phone-auto-row__subtitle">{subtitle}</span>
      {hasPills && (
        <span className="phone-auto-row__pills">
          {a.keywords.map((k) => (
            <Pill key={k} mono>
              {k}
            </Pill>
          ))}
          {buttons > 0 && <Pill>{t('table.buttonsCount', { count: buttons })}</Pill>}
          {a.dm_media && <Pill tone="info">{t('table.cardBadge')}</Pill>}
          {target.badge && <Pill tone={target.badge.tone}>{target.badge.label}</Pill>}
        </span>
      )}
      <span className="phone-auto-row__meta">
        {t('table.dmsSent')}: {a.dms_sent_count} ·{' '}
        {a.last_triggered_at ? shortDate(a.last_triggered_at) : t('neverTriggered')}
      </span>
    </span>
  );
}
