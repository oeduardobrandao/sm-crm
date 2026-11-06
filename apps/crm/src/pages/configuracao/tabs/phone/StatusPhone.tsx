import { createElement, useState } from 'react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell, PickerSheet } from '@/components/mobile/PickerSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { ContextMenu } from '@/components/mobile/ContextMenu';
import { SwipeRow } from '@/components/mobile/SwipeRow';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { Spinner } from '@/components/ui/spinner';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { CUSTOM_STATUS_ICONS, getCustomStatusIcon } from '@/pages/entregas/statusIcons';
import type {
  CustomStatusBehavesAs,
  PostStatusAutomation,
  PostStatusDefinition,
} from '../../../../store';
import { STATUS_LABELS } from '../../../entregas/postLabels';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../../phone/ConfigPhoneScreen';
import {
  ACTION_OPTIONS,
  automationActionLabel,
  automationNeedsMembro,
  automationTriggerLabel,
  BEHAVES_AS_OPTIONS,
  buildAutomationPayload,
  NOTIFY_TARGET_OPTIONS,
  PRESET_COLORS,
  triggerOptions,
  type AutomationAction,
  type AutomationCreatePayload,
  type NotifyTarget,
  type StatusCreatePayload,
  type TriggerValue,
} from './statusModel';
import './statusPhone.css';

/** Resolved per render: STATUS_LABELS follows the UI language. */
function behavesAsPickerOptions() {
  return BEHAVES_AS_OPTIONS.map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
  }));
}

export interface StatusPhoneProps {
  defs: PostStatusDefinition[];
  isLoading: boolean;
  /** A swap is in flight: the move actions are disabled, as on desktop. */
  reordering: boolean;
  /** The desktop Subir / Descer handler. */
  onMove: (index: number, dir: -1 | 1) => void;
  /** The desktop "Se comporta como" select's mutation. */
  onChangeBehavesAs: (def: PostStatusDefinition, behavesAs: CustomStatusBehavesAs) => void;
  /** Create mutation; `onCreated` runs on success only (closes the sheet). */
  onCreateStatus: (payload: StatusCreatePayload, onCreated: () => void) => void;
  creatingStatus: boolean;
  pendingArchive: PostStatusDefinition | null;
  onRequestArchive: (def: PostStatusDefinition) => void;
  onCancelArchive: () => void;
  onConfirmArchive: (def: PostStatusDefinition) => void;
  automations: PostStatusAutomation[];
  automationsLoading: boolean;
  membros: { id?: number; nome: string }[];
  onToggleAutomation: (a: PostStatusAutomation, ativo: boolean) => void;
  onRemoveAutomation: (a: PostStatusAutomation) => void;
  onCreateAutomation: (payload: AutomationCreatePayload, onCreated: () => void) => void;
  creatingAutomation: boolean;
}

function StatusIcon({ def }: { def: Pick<PostStatusDefinition, 'icone' | 'cor'> }) {
  // A lookup in a static icon map, not a component created per render.
  const icon = getCustomStatusIcon(def.icone);
  return (
    <span
      className="phone-status-icon"
      aria-hidden="true"
      style={{
        color: def.cor,
        background: `color-mix(in srgb, ${def.cor} 14%, transparent)`,
      }}
    >
      {icon ? (
        createElement(icon, { size: 17 })
      ) : (
        <span className="phone-status-icon__dot" style={{ background: def.cor }} />
      )}
    </span>
  );
}

/**
 * Configurações > Status de posts on phones (FConfigStatus mockup): the custom statuses
 * and the status automations as grouped lists, with the desktop's row buttons moved to
 * a long-press menu (plus its "…" trigger), swipe actions and bottom sheets. State,
 * queries and mutations stay in StatusTab.
 */
export function StatusPhone(props: StatusPhoneProps) {
  const {
    defs,
    isLoading,
    reordering,
    onMove,
    onChangeBehavesAs,
    pendingArchive,
    onRequestArchive,
    onCancelArchive,
    onConfirmArchive,
    automations,
    automationsLoading,
    membros,
    onToggleAutomation,
    onRemoveAutomation,
  } = props;
  const { t } = useTranslation('settingsHub');
  const [picking, setPicking] = useState<PostStatusDefinition | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PostStatusAutomation | null>(null);
  const [createStatusOpen, setCreateStatusOpen] = useState(false);
  const [createAutomationOpen, setCreateAutomationOpen] = useState(false);

  const removeTrigger = pendingRemove ? automationTriggerLabel(pendingRemove, defs) : '';
  const removeAction = pendingRemove ? automationActionLabel(pendingRemove, membros) : '';

  return (
    <ConfigPhoneScreen
      title={t('statusPhone.title')}
      trailing={
        <PhoneIconButton
          label={t('statusTab.newStatus')}
          variant="ink"
          onClick={() => setCreateStatusOpen(true)}
        >
          <Plus aria-hidden="true" />
        </PhoneIconButton>
      }
    >
      {isLoading ? (
        <ConfigPhoneSkeleton groups={1} rows={3} />
      ) : (
        <GroupedList header={t('statusTab.title')} footer={t('statusPhone.statusesFooter')}>
          {defs.length === 0 ? (
            <li className="phone-cell">
              <p className="phone-config-block phone-status-empty">{t('statusTab.empty')}</p>
            </li>
          ) : (
            defs.map((def, i) => (
              <SwipeRow
                key={def.id}
                as="li"
                className="phone-status-row"
                trailingActions={[
                  {
                    label: t('statusTab.archive'),
                    icon: <Archive />,
                    tone: 'destructive',
                    onAction: () => onRequestArchive(def),
                  },
                ]}
              >
                <ContextMenu
                  label={t('statusPhone.actionsOf', { name: def.nome })}
                  sections={[
                    [
                      {
                        label: t('statusPhone.moveUp'),
                        icon: <ArrowUp />,
                        disabled: i === 0 || reordering,
                        onSelect: () => onMove(i, -1),
                      },
                      {
                        label: t('statusPhone.moveDown'),
                        icon: <ArrowDown />,
                        disabled: i === defs.length - 1 || reordering,
                        onSelect: () => onMove(i, 1),
                      },
                    ],
                    [
                      {
                        label: t('statusTab.archive'),
                        icon: <Archive />,
                        destructive: true,
                        onSelect: () => onRequestArchive(def),
                      },
                    ],
                  ]}
                >
                  {({ triggerProps }) => (
                    <div className="phone-status-row__inner">
                      <button
                        type="button"
                        className="phone-status-row__main"
                        aria-haspopup="dialog"
                        onClick={() => setPicking(def)}
                      >
                        <StatusIcon def={def} />
                        <span className="phone-status-row__text">
                          <span className="phone-status-row__title">{def.nome}</span>
                          <span className="phone-status-row__subtitle">
                            {t('statusPhone.behavesAsValue', {
                              status: STATUS_LABELS[def.behaves_as],
                            })}
                          </span>
                        </span>
                      </button>
                      <button
                        {...triggerProps}
                        className="phone-status-row__more"
                        aria-label={t('statusPhone.moreActionsOf', { name: def.nome })}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </ContextMenu>
              </SwipeRow>
            ))
          )}
        </GroupedList>
      )}

      {automationsLoading ? (
        <ConfigPhoneSkeleton groups={1} rows={2} />
      ) : (
        <GroupedList
          header={t('statusTab.automationsTitle')}
          footer={automations.length > 0 ? t('statusPhone.automationsFooter') : undefined}
        >
          {automations.length === 0 && (
            <li className="phone-cell">
              <p className="phone-config-block phone-status-empty">{t('shared.noAutomations')}</p>
            </li>
          )}
          {automations.map((a) => {
            const trigger = automationTriggerLabel(a, defs);
            return (
              <SwipeRow
                key={a.id}
                as="li"
                className="phone-status-row"
                trailingActions={[
                  {
                    label: t('actions.delete'),
                    icon: <Trash2 />,
                    tone: 'destructive',
                    onAction: () => setPendingRemove(a),
                  },
                ]}
              >
                <div className="phone-status-auto">
                  <span className="phone-status-auto__text" data-inactive={!a.ativo || undefined}>
                    <span className="phone-status-auto__title">
                      <Trans
                        t={t}
                        i18nKey="statusTab.whenEntersRich"
                        values={{ status: trigger }}
                        components={{ b: <strong /> }}
                      />
                    </span>
                    <span className="phone-status-row__subtitle">
                      {automationActionLabel(a, membros)}
                      {a.ativo ? '' : t('statusPhone.inactiveSuffix')}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.ativo}
                    aria-label={t('statusPhone.automationAria', { trigger })}
                    className="phone-switch"
                    onClick={() => onToggleAutomation(a, !a.ativo)}
                  >
                    <span className="phone-switch__thumb" aria-hidden="true" />
                  </button>
                </div>
              </SwipeRow>
            );
          })}
          <Cell
            label={t('shared.newAutomation')}
            className="phone-status-new"
            icon={<Plus />}
            aria-haspopup="dialog"
            onClick={() => setCreateAutomationOpen(true)}
          />
        </GroupedList>
      )}

      <PickerSheet<CustomStatusBehavesAs>
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        title={t('shared.behavesAs')}
        description={picking?.nome}
        options={behavesAsPickerOptions()}
        value={picking?.behaves_as ?? null}
        onChange={(value) => {
          if (picking && value && value !== picking.behaves_as) onChangeBehavesAs(picking, value);
        }}
      />

      <PhoneConfirmSheet
        open={pendingArchive !== null}
        title={t('shared.archiveTitle', { name: pendingArchive?.nome ?? '' })}
        message={t('statusTab.archiveDescription', {
          status: pendingArchive ? STATUS_LABELS[pendingArchive.behaves_as] : '',
        })}
        actions={[
          {
            label: t('statusTab.archive'),
            destructive: true,
            onSelect: () => {
              if (pendingArchive) onConfirmArchive(pendingArchive);
            },
          },
        ]}
        onCancel={onCancelArchive}
      />

      <PhoneConfirmSheet
        open={pendingRemove !== null}
        title={t('statusPhone.removeTitle')}
        message={t('statusPhone.removeMessage', { trigger: removeTrigger, action: removeAction })}
        actions={[
          {
            label: t('actions.delete'),
            destructive: true,
            onSelect: () => {
              if (pendingRemove) onRemoveAutomation(pendingRemove);
              setPendingRemove(null);
            },
          },
        ]}
        onCancel={() => setPendingRemove(null)}
      />

      <BottomSheet
        open={createStatusOpen}
        onOpenChange={setCreateStatusOpen}
        title={t('statusTab.newStatus')}
        description={t('statusPhone.newStatusDescription')}
        detents={['large']}
      >
        <FeatureGate flag="feature_custom_properties" label={t('statusTab.title')}>
          <CreateStatusSheetBody
            creating={props.creatingStatus}
            onCreate={(payload) => props.onCreateStatus(payload, () => setCreateStatusOpen(false))}
          />
        </FeatureGate>
      </BottomSheet>

      <BottomSheet
        open={createAutomationOpen}
        onOpenChange={setCreateAutomationOpen}
        title={t('shared.newAutomation')}
        description={t('statusPhone.newAutomationDescription')}
        detents={['large']}
      >
        <FeatureGate flag="feature_custom_properties" label={t('statusTab.automationsTitle')}>
          <CreateAutomationSheetBody
            defs={defs}
            membros={membros}
            creating={props.creatingAutomation}
            onCreate={(payload) =>
              props.onCreateAutomation(payload, () => setCreateAutomationOpen(false))
            }
          />
        </FeatureGate>
      </BottomSheet>
    </ConfigPhoneScreen>
  );
}

/** The desktop CreateStatusForm as a sheet: Nome, Se comporta como, ícone and cor. */
function CreateStatusSheetBody({
  onCreate,
  creating,
}: {
  onCreate: (payload: StatusCreatePayload) => void;
  creating: boolean;
}) {
  const { t } = useTranslation('settingsHub');
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(PRESET_COLORS[1]);
  const [icone, setIcone] = useState<string | null>(null);
  const [behavesAs, setBehavesAs] = useState<CustomStatusBehavesAs>('revisao_interna');

  const submit = () => {
    const trimmed = nome.trim();
    if (!trimmed) {
      toast.error(t('shared.nameRequired'));
      return;
    }
    onCreate({ nome: trimmed, cor, icone, behaves_as: behavesAs });
  };

  return (
    <div className="phone-status-sheet">
      <GroupedList aria-label={t('statusTab.newStatus')}>
        <FormRow
          label={t('statusPhone.name')}
          input={{
            id: 'status-phone-nome',
            value: nome,
            maxLength: 40,
            placeholder: t('statusPhone.namePlaceholder'),
            autoComplete: 'off',
            onChange: (e) => setNome(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') submit();
            },
          }}
        />
        <PickerCell<CustomStatusBehavesAs>
          label={t('shared.behavesAs')}
          options={behavesAsPickerOptions()}
          value={behavesAs}
          onChange={(value) => {
            if (value) setBehavesAs(value);
          }}
        />
      </GroupedList>

      <GroupedList header={t('statusPhone.icon')}>
        <li className="phone-cell">
          <div className="phone-status-grid" role="group" aria-label={t('statusPhone.icon')}>
            <button
              type="button"
              className="phone-status-grid__item"
              aria-label={t('statusTab.noIcon')}
              aria-pressed={icone === null}
              onClick={() => setIcone(null)}
            >
              <span className="phone-status-icon__dot" style={{ background: cor }} />
            </button>
            {Object.entries(CUSTOM_STATUS_ICONS).map(([name, IconCmp]) => (
              <button
                key={name}
                type="button"
                className="phone-status-grid__item"
                aria-label={name}
                aria-pressed={icone === name}
                onClick={() => setIcone(name)}
              >
                <IconCmp size={20} aria-hidden="true" style={{ color: cor }} />
              </button>
            ))}
          </div>
        </li>
      </GroupedList>

      <GroupedList header={t('statusPhone.color')}>
        <li className="phone-cell">
          <div className="phone-status-grid" role="group" aria-label={t('statusPhone.color')}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="phone-status-grid__item phone-status-swatch"
                aria-label={t('statusPhone.colorValue', { color: c })}
                aria-pressed={cor === c}
                onClick={() => setCor(c)}
              >
                <span className="phone-status-swatch__fill" style={{ background: c }} />
              </button>
            ))}
          </div>
        </li>
      </GroupedList>

      <div className="phone-status-sheet__actions">
        <button
          type="button"
          className="phone-config-primary phone-config-primary--block"
          onClick={submit}
          disabled={creating}
          aria-busy={creating || undefined}
        >
          {creating ? <Spinner size="sm" /> : <Plus aria-hidden="true" />}
          {t('statusTab.newStatus')}
        </button>
      </div>
    </div>
  );
}

/** The desktop CreateAutomationForm as a sheet, with checkmark pickers for the selects. */
function CreateAutomationSheetBody({
  defs,
  membros,
  onCreate,
  creating,
}: {
  defs: PostStatusDefinition[];
  membros: { id?: number; nome: string }[];
  onCreate: (payload: AutomationCreatePayload) => void;
  creating: boolean;
}) {
  const { t } = useTranslation('settingsHub');
  const [trigger, setTrigger] = useState<TriggerValue>('canonical:correcao_cliente');
  const [action, setAction] = useState<AutomationAction>('notify');
  const [notifyTarget, setNotifyTarget] = useState<NotifyTarget>('responsavel');
  const [membroId, setMembroId] = useState<number | ''>('');

  const needsMembro = automationNeedsMembro(action, notifyTarget);
  const membroOptions = membros
    .filter((m): m is { id: number; nome: string } => m.id != null)
    .map((m) => ({ value: m.id, label: m.nome }));

  const submit = () => {
    const result = buildAutomationPayload({ trigger, action, notifyTarget, membroId });
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    onCreate(result.payload);
  };

  return (
    <div className="phone-status-sheet">
      <GroupedList aria-label={t('shared.newAutomation')}>
        <PickerCell<TriggerValue>
          label={t('shared.whenEnters')}
          options={triggerOptions(defs)}
          value={trigger}
          onChange={(value) => {
            if (value) setTrigger(value);
          }}
        />
        <PickerCell<AutomationAction>
          label={t('statusPhone.action')}
          options={ACTION_OPTIONS}
          value={action}
          onChange={(value) => {
            if (value) setAction(value);
          }}
        />
        {action === 'notify' && (
          <PickerCell<NotifyTarget>
            label={t('statusModel.action.notify')}
            options={NOTIFY_TARGET_OPTIONS}
            value={notifyTarget}
            onChange={(value) => {
              if (value) setNotifyTarget(value);
            }}
          />
        )}
        {needsMembro && (
          <PickerCell<number>
            label={t('statusPhone.member')}
            options={membroOptions}
            value={membroId === '' ? null : membroId}
            placeholder={t('shared.chooseMemberOption')}
            searchable={membroOptions.length > 8}
            onChange={(value) => setMembroId(value ?? '')}
          />
        )}
      </GroupedList>

      <div className="phone-status-sheet__actions">
        <button
          type="button"
          className="phone-config-primary phone-config-primary--block"
          onClick={submit}
          disabled={creating}
          aria-busy={creating || undefined}
        >
          {creating ? <Spinner size="sm" /> : <Plus aria-hidden="true" />}
          {t('shared.newAutomation')}
        </button>
      </div>
    </div>
  );
}
