import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  AGENT_ROLE_PRESET,
  PERMISSION_MODULES,
  type PermissionLevel,
  type PermissionModule,
} from '@/lib/permissions';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useAuth } from '../../../context/AuthContext';
import {
  createWorkspaceRole,
  deleteWorkspaceRole,
  getWorkspaceRoleMemberCounts,
  getWorkspaceRoles,
  updateWorkspaceRole,
  type WorkspaceRole,
} from '../../../store';
import {
  adminPermissionOverrides,
  ADMIN_PERMISSIONS,
  adminSummary,
  levelLabel,
  LEVEL_ORDER,
  levelSegmentLabel,
  memberCountLabel,
  MODULE_GROUPS,
  moduleGroupLabel,
  moduleLabel,
  normalizePermissions,
  presetLabel,
  PRESET_ORDER,
  presetPermissions,
  SERVER_ENFORCED_MODULES,
  summarizePermissions,
  type PermissionOverrides,
  type PresetChoice,
  type RoleFormState,
  type RolePermissions,
} from './phone/papeisModel';
import { PapeisPhone } from './phone/PapeisPhone';

/**
 * Maps manage-workspace-roles error codes to user-facing copy.
 * invalid_role_id/invalid_action are internal guards (malformed payload from
 * this very form) — never expected in practice, so they fall through to the
 * same generic message as an unrecognized/network error rather than getting
 * dedicated copy.
 */
function roleErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'not_owner':
      return i18n.t('settings:papeis.errors.notOwner');
    case 'invalid_name':
      return i18n.t('settings:papeis.errors.invalidName');
    case 'invalid_permissions':
      return i18n.t('settings:papeis.errors.invalidPermissions');
    case 'duplicate_name':
      return i18n.t('settings:papeis.errors.duplicateName');
    case 'role_in_use':
      return i18n.t('settings:papeis.errors.roleInUse');
    case 'role_not_found':
      return i18n.t('settings:papeis.errors.roleNotFound');
    default:
      return i18n.t('settings:papeis.errors.generic');
  }
}

interface ChipEntry {
  mod: PermissionModule;
  override?: string;
}

/** Buckets every module into its Pode editar / Pode ver / Sem acesso group,
 * carrying the override text (if any) alongside instead of the plain level so
 * PermissionChipGroups can render the amber "cond" chip in the module's place. */
function groupPermissions(
  permissions: RolePermissions,
  overrides?: PermissionOverrides,
): Record<PermissionLevel, ChipEntry[]> {
  const groups: Record<PermissionLevel, ChipEntry[]> = { editar: [], ver: [], none: [] };
  for (const mod of PERMISSION_MODULES) {
    groups[permissions[mod]].push({ mod, override: overrides?.[mod] });
  }
  return groups;
}

function PermissionChip({
  variant,
  children,
}: {
  variant: 'editar' | 'ver' | 'none' | 'cond';
  children: React.ReactNode;
}) {
  if (variant === 'cond') {
    return (
      <Badge variant="warning" tone="soft" size="sm" style={{ borderStyle: 'dashed' }}>
        {children}
      </Badge>
    );
  }
  if (variant === 'ver') {
    return (
      <Badge variant="outline" tone="soft" size="sm">
        {children}
      </Badge>
    );
  }
  if (variant === 'none') {
    return (
      <Badge variant="neutral" tone="soft" size="sm">
        {children}
      </Badge>
    );
  }
  // 'editar' — filled/high-emphasis. Reuses the badge's own solid-fill custom
  // properties with the app's ink/paper tokens instead of a hardcoded hex, so
  // it inverts correctly in dark mode along with --text-main/--card-bg.
  return (
    <Badge
      variant="neutral"
      tone="solid"
      size="sm"
      style={
        {
          '--badge-solid-bg': 'var(--text-main)',
          '--badge-solid-fg': 'var(--card-bg)',
        } as React.CSSProperties
      }
    >
      {children}
    </Badge>
  );
}

/** Three grouped chip rows (Pode editar / Pode ver / Sem acesso), each omitted
 * when empty — mirrors the "omit zero segments" rule used in the one-line
 * summary. `overrides` swaps a module's normal chip for an amber dashed one
 * carrying the override text (Administrador's Financeiro today). */
function PermissionChipGroups({
  permissions,
  overrides,
}: {
  permissions: RolePermissions;
  overrides?: PermissionOverrides;
}) {
  const groups = groupPermissions(permissions, overrides);
  const order: PermissionLevel[] = ['editar', 'ver', 'none'];
  return (
    <div
      style={{
        marginTop: '0.75rem',
        paddingTop: '0.65rem',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {order.map((level) => {
        const entries = groups[level];
        if (entries.length === 0) return null;
        return (
          <div key={level} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <span
              style={{
                minWidth: 84,
                flexShrink: 0,
                color: 'var(--text-muted)',
                fontSize: '0.68rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
                paddingTop: 3,
              }}
            >
              {levelLabel(level)}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {entries.map((entry) =>
                entry.override ? (
                  <PermissionChip key={entry.mod} variant="cond">
                    {entry.override}
                  </PermissionChip>
                ) : (
                  <PermissionChip key={entry.mod} variant={level}>
                    {moduleLabel(entry.mod)}
                  </PermissionChip>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleRow({
  nome,
  isSystem,
  memberCount,
  permissions,
  summary,
  permissionOverrides,
  onEdit,
  onDelete,
}: {
  nome: string;
  isSystem: boolean;
  memberCount: number;
  permissions: RolePermissions;
  summary: string;
  permissionOverrides?: PermissionOverrides;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation('settings');
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="config-member-row"
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        padding: '0.85rem 1.1rem',
        marginBottom: '0.6rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flex: 1,
            minWidth: 0,
            background: 'none',
            border: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
          }}
        >
          {expanded ? (
            <ChevronDown
              className="h-4 w-4"
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          ) : (
            <ChevronRight
              className="h-4 w-4"
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontWeight: 500 }}>{nome}</span>
              {isSystem ? (
                <Badge variant="neutral" size="sm">
                  {t('papeis.systemDefault')}
                </Badge>
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {memberCountLabel(memberCount)}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{summary}</span>
          </div>
        </button>
        {!isSystem && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t('actions.edit')}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
              {t('papeis.delete')}
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <PermissionChipGroups permissions={permissions} overrides={permissionOverrides} />
      )}
    </div>
  );
}

function ServerTag() {
  const { t } = useTranslation('settings');
  return <span className="papeis-server-tag">{t('papeis.server')}</span>;
}

/** 3-state segmented control (Sem acesso / Ver / Editar) replacing the old
 * per-module Select — one click per module, every state visible at once.
 * Built on the same Radix ToggleGroup used by PlatformSelector, which gives
 * radiogroup semantics (role="radio" per item) and keyboard nav for free.
 * Skinned with the Agenda's segmented classes so every level shares one
 * selected look; `.papeis-seg` only sizes the three segments equally. */
function LevelSegmented({
  mod,
  value,
  onChange,
}: {
  mod: PermissionModule;
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
}) {
  const { t } = useTranslation('settings');
  const handleChange = (next: string) => {
    if (!next || next === value) return;
    onChange(next as PermissionLevel);
  };
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={handleChange}
      aria-label={t('papeis.levelAria', { module: moduleLabel(mod) })}
      className="agenda-segmented papeis-seg"
    >
      {LEVEL_ORDER.map((level) => (
        <ToggleGroupItem key={level} value={level} className="agenda-segmented__item">
          {levelSegmentLabel(level)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Owner-only "Papéis" tab: system presets (read-only) + CRUD of custom papéis. */
export default function PapeisTab() {
  const { t } = useTranslation('settings');
  const { workspaceRole } = useAuth();
  const isOwner = workspaceRole === 'owner';
  const queryClient = useQueryClient();
  const isPhone = !useIsDesktop(768);

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['workspace-roles'],
    queryFn: getWorkspaceRoles,
    enabled: isOwner,
  });

  const { data: memberCounts } = useQuery({
    queryKey: ['workspace-role-members'],
    queryFn: getWorkspaceRoleMemberCounts,
    enabled: isOwner,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RoleFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRole | null>(null);

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(null);
  };

  const createMutation = useMutation({
    mutationFn: (vars: { nome: string; permissions: RolePermissions }) =>
      createWorkspaceRole(vars.nome, vars.permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles'] });
      closeDialog();
      toast.success(i18n.t('settings:papeis.created'));
    },
    onError: (err: unknown) => toast.error(roleErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { roleId: string; nome: string; permissions: RolePermissions }) =>
      updateWorkspaceRole(vars.roleId, vars.nome, vars.permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles'] });
      closeDialog();
      toast.success(i18n.t('settings:papeis.updated'));
    },
    onError: (err: unknown) => toast.error(roleErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => deleteWorkspaceRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles'] });
      setDeleteTarget(null);
      toast.success(i18n.t('settings:papeis.deleted'));
    },
    onError: (err: unknown) => {
      toast.error(roleErrorMessage(err));
      setDeleteTarget(null);
    },
  });

  // configTabs `roles` only hides the tab from the nav; this is the real gate.
  if (!isOwner) return null;

  const customRoles = roles ?? [];

  const openCreateDialog = () => {
    setForm({
      roleId: null,
      nome: '',
      permissions: presetPermissions('em_branco'),
      preset: 'em_branco',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (role: WorkspaceRole) => {
    setForm({
      roleId: role.id,
      nome: role.nome,
      permissions: normalizePermissions(role.permissions),
      preset: 'em_branco',
    });
    setDialogOpen(true);
  };

  const handlePresetChange = (preset: PresetChoice) => {
    setForm((f) => (f ? { ...f, preset, permissions: presetPermissions(preset) } : f));
  };

  const handleLevelChange = (mod: PermissionModule, level: PermissionLevel) => {
    setForm((f) => (f ? { ...f, permissions: { ...f.permissions, [mod]: level } } : f));
  };

  const handleSave = () => {
    if (!form) return;
    const nome = form.nome.trim();
    if (!nome) {
      toast.error(t('papeis.errors.invalidName'));
      return;
    }
    if (form.roleId) {
      updateMutation.mutate({ roleId: form.roleId, nome, permissions: form.permissions });
    } else {
      createMutation.mutate({ nome, permissions: form.permissions });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const editingMemberCount = form?.roleId ? (memberCounts?.[form.roleId] ?? 0) : 0;

  if (isPhone) {
    return (
      <PapeisPhone
        roles={customRoles}
        rolesLoading={rolesLoading}
        memberCounts={memberCounts}
        form={form}
        saving={saving}
        onOpenCreate={openCreateDialog}
        onOpenEdit={openEditDialog}
        onCloseForm={closeDialog}
        onNomeChange={(nome) => setForm((f) => (f ? { ...f, nome } : f))}
        onPresetChange={handlePresetChange}
        onLevelChange={handleLevelChange}
        onSave={handleSave}
        deleteTarget={deleteTarget}
        onRequestDelete={setDeleteTarget}
        onCancelDelete={() => setDeleteTarget(null)}
        onConfirmDelete={(role, onDeleted) =>
          deleteMutation.mutate(role.id, { onSuccess: onDeleted })
        }
      />
    );
  }

  return (
    <>
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="config-title">{t('tabs.papeis')}</h3>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" /> {t('papeis.newRole')}
          </Button>
        </div>

        <RoleRow
          nome={t('papeis.presets.administrador')}
          isSystem
          memberCount={0}
          permissions={ADMIN_PERMISSIONS}
          summary={adminSummary()}
          permissionOverrides={adminPermissionOverrides()}
        />
        <RoleRow
          nome={t('papeis.presets.agente')}
          isSystem
          memberCount={0}
          permissions={AGENT_ROLE_PRESET}
          summary={summarizePermissions(AGENT_ROLE_PRESET)}
        />

        {customRoles.map((role) => {
          const permissions = normalizePermissions(role.permissions);
          return (
            <RoleRow
              key={role.id}
              nome={role.nome}
              isSystem={false}
              memberCount={memberCounts?.[role.id] ?? 0}
              permissions={permissions}
              summary={summarizePermissions(permissions)}
              onEdit={() => openEditDialog(role)}
              onDelete={() => setDeleteTarget(role)}
            />
          );
        })}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent style={{ maxWidth: 680 }}>
          <DialogHeader>
            <DialogTitle>
              {form?.roleId ? t('papeis.editRole') : t('papeis.createRole')}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="papeis-nome">{t('shared.name')}</Label>
                <Input
                  id="papeis-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>

              {!form.roleId && (
                <div className="space-y-1">
                  <Label>{t('papeis.startFrom')}</Label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {PRESET_ORDER.map((preset) => {
                      const selected = form.preset === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handlePresetChange(preset)}
                          aria-pressed={selected}
                          style={{
                            border: `1px solid ${selected ? 'var(--text-main)' : 'var(--border-color)'}`,
                            borderRadius: 999,
                            padding: '4px 14px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: selected ? 'var(--text-main)' : 'var(--card-bg)',
                            color: selected ? 'var(--card-bg)' : 'var(--text-muted)',
                          }}
                        >
                          {presetLabel(preset)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {form.roleId && editingMemberCount > 0 && (
                <p role="alert" style={{ fontSize: '0.8rem', color: 'var(--warning)', margin: 0 }}>
                  {t('papeis.changesApply', { count: editingMemberCount })}
                </p>
              )}

              <div>
                {MODULE_GROUPS.map((group) => (
                  <section key={group.key} className="papeis-form-group">
                    <div className="papeis-form-group-label">{moduleGroupLabel(group.key)}</div>
                    <div className="papeis-form-panel">
                      {group.modules.map((mod) => (
                        <div key={mod} className="papeis-form-row">
                          <Label className="papeis-form-row__label">
                            {moduleLabel(mod)}
                            {SERVER_ENFORCED_MODULES.has(mod) && <ServerTag />}
                          </Label>
                          <LevelSegmented
                            mod={mod}
                            value={form.permissions[mod]}
                            onChange={(level) => handleLevelChange(mod, level)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <p className="papeis-form-note">{t('papeis.serverNote')}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />}{' '}
              {form?.roleId ? t('papeis.saveChanges') : t('papeis.createRole')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('papeis.deleteTitle', { name: deleteTarget?.nome ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('papeis.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {t('papeis.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
