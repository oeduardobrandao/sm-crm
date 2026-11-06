import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { FormRow } from '@/components/mobile/FormRow';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { Spinner } from '@/components/ui/spinner';
import { AGENT_ROLE_PRESET, type PermissionLevel, type PermissionModule } from '@/lib/permissions';
import type { WorkspaceRole } from '../../../../store';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../../phone/ConfigPhoneScreen';
import { useConfigSubScreen } from '../../phone/useConfigSubScreen';
import {
  adminPermissionOverrides,
  ADMIN_PERMISSIONS,
  levelLabel,
  LEVEL_ORDER,
  levelSegmentLabel,
  MODULE_GROUPS,
  moduleGroupLabel,
  moduleLabel,
  memberCountLabel,
  normalizePermissions,
  presetLabel,
  PRESET_ORDER,
  SERVER_ENFORCED_MODULES,
  summarizePermissions,
  type PermissionOverrides,
  type PresetChoice,
  type RoleFormState,
  type RolePermissions,
} from './papeisModel';
import './papeisPhone.css';

type PapelScreen =
  | { kind: 'system'; which: 'administrador' | 'agente' }
  | { kind: 'edit'; role: WorkspaceRole }
  | { kind: 'create' };

export interface PapeisPhoneProps {
  roles: WorkspaceRole[];
  /** The custom roles are still loading (the system rows need no data). */
  rolesLoading: boolean;
  memberCounts: Record<string, number> | undefined;
  /** The tab's create/edit form; null while no role is being edited. */
  form: RoleFormState | null;
  saving: boolean;
  onOpenCreate: () => void;
  onOpenEdit: (role: WorkspaceRole) => void;
  /** Drops the tab's form (the desktop Dialog's close). */
  onCloseForm: () => void;
  onNomeChange: (nome: string) => void;
  onPresetChange: (preset: PresetChoice) => void;
  onLevelChange: (mod: PermissionModule, level: PermissionLevel) => void;
  /** Same validation + create/update mutation as the desktop Dialog's save. */
  onSave: () => void;
  deleteTarget: WorkspaceRole | null;
  onRequestDelete: (role: WorkspaceRole) => void;
  onCancelDelete: () => void;
  /** Runs the tab's delete mutation; `onDeleted` fires on success only. */
  onConfirmDelete: (role: WorkspaceRole, onDeleted: () => void) => void;
}

function ServerTag() {
  const { t } = useTranslation('settings');
  return <span className="phone-papeis-server-tag">{t('papeis.server')}</span>;
}

/**
 * Configurações > Papéis on phones: the roles as a grouped list, each one pushing a
 * role screen in place (read-only levels for the system roles, the editor for custom
 * ones and for "Novo papel"). State, validation and mutations stay in PapeisTab.
 */
export function PapeisPhone(props: PapeisPhoneProps) {
  const { t } = useTranslation('settings');
  const {
    roles,
    rolesLoading,
    memberCounts,
    form,
    onOpenCreate,
    onOpenEdit,
    onCloseForm,
    deleteTarget,
    onCancelDelete,
    onConfirmDelete,
  } = props;
  const sub = useConfigSubScreen<PapelScreen>();
  const { screen, close } = sub;
  const isFormScreen = screen !== null && screen.kind !== 'system';

  // A successful save clears the tab's form: leave the role screen with it.
  useEffect(() => {
    if (isFormScreen && form === null) close();
  }, [isFormScreen, form, close]);
  // Back (nav bar, browser, edge swipe) only closes the screen: drop the form too.
  useEffect(() => {
    if (screen === null && form !== null) onCloseForm();
  }, [screen, form, onCloseForm]);

  const confirmSheet = (
    <PhoneConfirmSheet
      open={deleteTarget !== null}
      title={t('papeis.deleteTitle', { name: deleteTarget?.nome ?? '' })}
      message={t('papeis.deleteBody')}
      actions={[
        {
          label: t('papeis.delete'),
          destructive: true,
          onSelect: () => {
            if (deleteTarget) onConfirmDelete(deleteTarget, onCloseForm);
          },
        },
      ]}
      onCancel={onCancelDelete}
    />
  );

  if (screen?.kind === 'system') {
    const isAdmin = screen.which === 'administrador';
    return (
      <SystemRoleScreen
        nome={isAdmin ? t('papeis.presets.administrador') : t('papeis.presets.agente')}
        permissions={isAdmin ? ADMIN_PERMISSIONS : AGENT_ROLE_PRESET}
        overrides={isAdmin ? adminPermissionOverrides() : undefined}
        onBack={close}
      />
    );
  }

  if (isFormScreen && form) {
    return (
      <>
        <RoleFormScreen
          {...props}
          form={form}
          editingRole={screen.kind === 'edit' ? screen.role : null}
          onBack={close}
        />
        {confirmSheet}
      </>
    );
  }

  return (
    <ConfigPhoneScreen
      title={t('tabs.papeis')}
      trailing={
        <PhoneIconButton
          label={t('papeis.newRole')}
          variant="ink"
          onClick={() => {
            onOpenCreate();
            sub.open({ kind: 'create' });
          }}
        >
          <Plus aria-hidden="true" />
        </PhoneIconButton>
      }
    >
      <GroupedList
        aria-label={t('tabs.papeis')}
        footer={!rolesLoading && roles.length === 0 ? t('papeis.emptyFooter') : undefined}
      >
        <Cell
          label={t('papeis.presets.administrador')}
          subtitle={t('papeis.systemDefault')}
          chevron
          onClick={() => sub.open({ kind: 'system', which: 'administrador' })}
        />
        <Cell
          label={t('papeis.presets.agente')}
          subtitle={t('papeis.systemDefault')}
          chevron
          onClick={() => sub.open({ kind: 'system', which: 'agente' })}
        />
        {roles.map((role) => {
          const summary = summarizePermissions(normalizePermissions(role.permissions));
          return (
            <Cell
              key={role.id}
              label={role.nome}
              subtitle={t('papeis.rowSubtitle', {
                members: memberCountLabel(memberCounts?.[role.id] ?? 0),
                summary,
              })}
              chevron
              onClick={() => {
                onOpenEdit(role);
                sub.open({ kind: 'edit', role });
              }}
            />
          );
        })}
      </GroupedList>
      {rolesLoading && <ConfigPhoneSkeleton groups={1} rows={2} />}
    </ConfigPhoneScreen>
  );
}

/** Read-only levels of Administrador / Agente (the desktop's expanded chip rows). */
function SystemRoleScreen({
  nome,
  permissions,
  overrides,
  onBack,
}: {
  nome: string;
  permissions: RolePermissions;
  overrides?: PermissionOverrides;
  onBack: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <ConfigPhoneScreen title={nome} subtitle={t('papeis.systemDefault')} onBack={onBack}>
      {MODULE_GROUPS.map((group, gi) => (
        <GroupedList
          key={group.key}
          header={moduleGroupLabel(group.key)}
          footer={gi === MODULE_GROUPS.length - 1 ? t('papeis.serverNote') : undefined}
        >
          {group.modules.map((mod) => {
            const override = overrides?.[mod];
            return (
              <Cell
                key={mod}
                label={
                  <>
                    {moduleLabel(mod)}
                    {SERVER_ENFORCED_MODULES.has(mod) && <ServerTag />}
                  </>
                }
                subtitle={override}
                value={override ? undefined : levelLabel(permissions[mod])}
              />
            );
          })}
        </GroupedList>
      ))}
    </ConfigPhoneScreen>
  );
}

function serializeForm(form: RoleFormState): string {
  return JSON.stringify({ nome: form.nome, permissions: form.permissions });
}

/** The create/edit editor, pushed in place of the list (FConfigPapel mockup). */
function RoleFormScreen({
  form,
  editingRole,
  memberCounts,
  saving,
  onNomeChange,
  onPresetChange,
  onLevelChange,
  onSave,
  onRequestDelete,
  onBack,
}: PapeisPhoneProps & {
  form: RoleFormState;
  editingRole: WorkspaceRole | null;
  onBack: () => void;
}) {
  // Mounted with the form already set (both change in the same tap), so this is the
  // state the screen opened with. No close confirmation, as on desktop: only the
  // silent-update hold while there is something to lose.
  const { t } = useTranslation('settings');
  const [initial] = useState(() => serializeForm(form));
  const dirty = serializeForm(form) !== initial;
  useUnsavedWork(dirty || saving);

  const memberCount = form.roleId ? (memberCounts?.[form.roleId] ?? 0) : 0;
  const isEdit = form.roleId !== null;

  return (
    <ConfigPhoneScreen
      title={editingRole ? editingRole.nome : t('papeis.newRole')}
      subtitle={
        isEdit ? t('papeis.customSubtitle', { members: memberCountLabel(memberCount) }) : undefined
      }
      onBack={onBack}
      trailing={
        editingRole ? (
          <PhoneIconButton
            label={t('papeis.deleteRole')}
            className="phone-papeis-delete"
            onClick={() => onRequestDelete(editingRole)}
          >
            <Trash2 aria-hidden="true" />
          </PhoneIconButton>
        ) : undefined
      }
    >
      <GroupedList aria-label={t('papeis.roleAria')}>
        <FormRow
          label={t('shared.name')}
          input={{
            id: 'papeis-phone-nome',
            value: form.nome,
            placeholder: t('papeis.namePlaceholder'),
            autoComplete: 'off',
            onChange: (e) => onNomeChange(e.target.value),
          }}
        />
      </GroupedList>

      {!isEdit && (
        <GroupedList header={t('papeis.startFrom')}>
          <li className="phone-cell phone-papeis-preset">
            <SegmentedControl<PresetChoice>
              aria-label={t('papeis.startFrom')}
              value={form.preset}
              onChange={onPresetChange}
              options={PRESET_ORDER.map((preset) => ({
                value: preset,
                label: presetLabel(preset),
              }))}
            />
          </li>
        </GroupedList>
      )}

      {isEdit && memberCount > 0 && (
        <p role="alert" className="phone-papeis-warning">
          {t('papeis.changesApply', { count: memberCount })}
        </p>
      )}

      {MODULE_GROUPS.map((group, gi) => (
        <GroupedList
          key={group.key}
          header={moduleGroupLabel(group.key)}
          footer={gi === MODULE_GROUPS.length - 1 ? t('papeis.serverNote') : undefined}
        >
          {group.modules.map((mod) => (
            <li key={mod} className="phone-cell phone-papeis-module">
              <span className="phone-papeis-module__label">
                {moduleLabel(mod)}
                {SERVER_ENFORCED_MODULES.has(mod) && <ServerTag />}
              </span>
              <SegmentedControl<PermissionLevel>
                className="phone-papeis-level"
                aria-label={t('papeis.levelAria', { module: moduleLabel(mod) })}
                value={form.permissions[mod]}
                onChange={(level) => onLevelChange(mod, level)}
                options={LEVEL_ORDER.map((level) => ({
                  value: level,
                  label: levelSegmentLabel(level),
                }))}
              />
            </li>
          ))}
        </GroupedList>
      ))}

      <BottomActionBar aboveTabBar>
        <button
          type="button"
          className="phone-config-primary phone-config-primary--block"
          onClick={onSave}
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving && <Spinner size="sm" />}
          {isEdit ? t('papeis.saveChanges') : t('papeis.createRole')}
        </button>
      </BottomActionBar>
    </ConfigPhoneScreen>
  );
}
