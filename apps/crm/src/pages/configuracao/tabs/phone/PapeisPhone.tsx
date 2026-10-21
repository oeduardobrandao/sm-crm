import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  ADMIN_PERMISSION_OVERRIDES,
  ADMIN_PERMISSIONS,
  LEVEL_LABELS,
  LEVEL_ORDER,
  LEVEL_SEGMENT_LABELS,
  MODULE_GROUPS,
  MODULE_LABELS,
  memberCountLabel,
  normalizePermissions,
  PRESET_LABELS,
  PRESET_ORDER,
  SERVER_ENFORCED_MODULES,
  summarizePermissions,
  type PermissionOverrides,
  type PresetChoice,
  type RoleFormState,
  type RolePermissions,
} from './papeisModel';
import './papeisPhone.css';

const SERVER_FOOTER =
  'Módulos com selo "servidor" são aplicados no banco. Os demais são aplicados na interface do CRM.';

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
  return <span className="phone-papeis-server-tag">servidor</span>;
}

/**
 * Configurações > Papéis on phones: the roles as a grouped list, each one pushing a
 * role screen in place (read-only levels for the system roles, the editor for custom
 * ones and for "Novo papel"). State, validation and mutations stay in PapeisTab.
 */
export function PapeisPhone(props: PapeisPhoneProps) {
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
      title={`Excluir papel "${deleteTarget?.nome ?? ''}"?`}
      message="Esta ação não pode ser desfeita."
      actions={[
        {
          label: 'Excluir',
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
        nome={isAdmin ? 'Administrador' : 'Agente'}
        permissions={isAdmin ? ADMIN_PERMISSIONS : AGENT_ROLE_PRESET}
        overrides={isAdmin ? ADMIN_PERMISSION_OVERRIDES : undefined}
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
      title="Papéis"
      trailing={
        <PhoneIconButton
          label="Novo papel"
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
        aria-label="Papéis"
        footer={
          !rolesLoading && roles.length === 0
            ? 'Toque em + para criar um papel personalizado.'
            : undefined
        }
      >
        <Cell
          label="Administrador"
          subtitle="Padrão do sistema"
          chevron
          onClick={() => sub.open({ kind: 'system', which: 'administrador' })}
        />
        <Cell
          label="Agente"
          subtitle="Padrão do sistema"
          chevron
          onClick={() => sub.open({ kind: 'system', which: 'agente' })}
        />
        {roles.map((role) => {
          const summary = summarizePermissions(normalizePermissions(role.permissions));
          return (
            <Cell
              key={role.id}
              label={role.nome}
              subtitle={`${memberCountLabel(memberCounts?.[role.id] ?? 0)} · ${summary}`}
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
  return (
    <ConfigPhoneScreen title={nome} subtitle="Padrão do sistema" onBack={onBack}>
      {MODULE_GROUPS.map((group, gi) => (
        <GroupedList
          key={group.label}
          header={group.label}
          footer={gi === MODULE_GROUPS.length - 1 ? SERVER_FOOTER : undefined}
        >
          {group.modules.map((mod) => {
            const override = overrides?.[mod];
            return (
              <Cell
                key={mod}
                label={
                  <>
                    {MODULE_LABELS[mod]}
                    {SERVER_ENFORCED_MODULES.has(mod) && <ServerTag />}
                  </>
                }
                subtitle={override}
                value={override ? undefined : LEVEL_LABELS[permissions[mod]]}
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
  const [initial] = useState(() => serializeForm(form));
  const dirty = serializeForm(form) !== initial;
  useUnsavedWork(dirty || saving);

  const memberCount = form.roleId ? (memberCounts?.[form.roleId] ?? 0) : 0;
  const isEdit = form.roleId !== null;

  return (
    <ConfigPhoneScreen
      title={editingRole ? editingRole.nome : 'Novo papel'}
      subtitle={isEdit ? `Papel personalizado · ${memberCountLabel(memberCount)}` : undefined}
      onBack={onBack}
      trailing={
        editingRole ? (
          <PhoneIconButton
            label="Excluir papel"
            className="phone-papeis-delete"
            onClick={() => onRequestDelete(editingRole)}
          >
            <Trash2 aria-hidden="true" />
          </PhoneIconButton>
        ) : undefined
      }
    >
      <GroupedList aria-label="Papel">
        <FormRow
          label="Nome"
          input={{
            id: 'papeis-phone-nome',
            value: form.nome,
            placeholder: 'Nome do papel',
            autoComplete: 'off',
            onChange: (e) => onNomeChange(e.target.value),
          }}
        />
      </GroupedList>

      {!isEdit && (
        <GroupedList header="Começar de">
          <li className="phone-cell phone-papeis-preset">
            <SegmentedControl<PresetChoice>
              aria-label="Começar de"
              value={form.preset}
              onChange={onPresetChange}
              options={PRESET_ORDER.map((preset) => ({
                value: preset,
                label: PRESET_LABELS[preset],
              }))}
            />
          </li>
        </GroupedList>
      )}

      {isEdit && memberCount > 0 && (
        <p role="alert" className="phone-papeis-warning">
          As mudanças valem na hora para{' '}
          {memberCount === 1 ? 'o 1 membro' : `os ${memberCount} membros`} com este papel.
        </p>
      )}

      {MODULE_GROUPS.map((group, gi) => (
        <GroupedList
          key={group.label}
          header={group.label}
          footer={gi === MODULE_GROUPS.length - 1 ? SERVER_FOOTER : undefined}
        >
          {group.modules.map((mod) => (
            <li key={mod} className="phone-cell phone-papeis-module">
              <span className="phone-papeis-module__label">
                {MODULE_LABELS[mod]}
                {SERVER_ENFORCED_MODULES.has(mod) && <ServerTag />}
              </span>
              <SegmentedControl<PermissionLevel>
                className="phone-papeis-level"
                aria-label={`Nível de acesso para ${MODULE_LABELS[mod]}`}
                value={form.permissions[mod]}
                onChange={(level) => onLevelChange(mod, level)}
                options={LEVEL_ORDER.map((level) => ({
                  value: level,
                  label: LEVEL_SEGMENT_LABELS[level],
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
          {isEdit ? 'Salvar alterações' : 'Criar papel'}
        </button>
      </BottomActionBar>
    </ConfigPhoneScreen>
  );
}
