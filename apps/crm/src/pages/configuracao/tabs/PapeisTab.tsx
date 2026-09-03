import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
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
import { useAuth } from '../../../context/AuthContext';
import {
  createWorkspaceRole,
  deleteWorkspaceRole,
  getWorkspaceRoleMemberCounts,
  getWorkspaceRoles,
  updateWorkspaceRole,
  type WorkspaceRole,
} from '../../../store';

const MODULE_LABELS: Record<PermissionModule, string> = {
  clientes: 'Clientes',
  entregas: 'Entregas',
  calendario: 'Calendário',
  aprovacoes: 'Aprovações',
  arquivos: 'Arquivos',
  ideias: 'Ideias',
  tarefas: 'Tarefas',
  leads: 'Leads',
  financeiro: 'Financeiro',
  contratos: 'Contratos',
  equipe: 'Equipe',
  analytics: 'Analytics e Relatórios',
  automacoes: 'Automações',
  configuracoes: 'Configurações do workspace',
};

/** Group headers reused as-is for the list's expanded chip rows (Pode editar /
 * Pode ver / Sem acesso, in that order — see PermissionChipGroups). */
const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: 'Sem acesso',
  ver: 'Pode ver',
  editar: 'Pode editar',
};

/** Short labels for the form's 3-state segmented control (variant 1 of the
 * approved mockup drops the "Pode" prefix on Ver/Editar to fit the pill). */
const LEVEL_SEGMENT_LABELS: Record<PermissionLevel, string> = {
  none: 'Sem acesso',
  ver: 'Ver',
  editar: 'Editar',
};

/** Grouped single-column sections for the edit/create form (papeis-form-edicao,
 * variant 1 — "Lista única, agrupada por área"). Order matches the mockup. */
const MODULE_GROUPS: { label: string; modules: PermissionModule[] }[] = [
  {
    label: 'Trabalho',
    modules: ['entregas', 'calendario', 'aprovacoes', 'ideias', 'tarefas', 'arquivos'],
  },
  { label: 'Clientes e análise', modules: ['clientes', 'analytics', 'leads'] },
  {
    label: 'Gestão',
    modules: ['financeiro', 'contratos', 'equipe', 'automacoes', 'configuracoes'],
  },
];

/** Modules whose permission is enforced server-side (RLS / RPC), shown with the
 * "servidor" tag in the form per the mockup — the rest are CRM-UI-only gates. */
const SERVER_ENFORCED_MODULES = new Set<PermissionModule>([
  'leads',
  'financeiro',
  'contratos',
  'equipe',
  'automacoes',
  'configuracoes',
]);

type RolePermissions = Record<PermissionModule, PermissionLevel>;

function buildPermissions(level: PermissionLevel): RolePermissions {
  return PERMISSION_MODULES.reduce((acc, mod) => {
    acc[mod] = level;
    return acc;
  }, {} as RolePermissions);
}

const ADMIN_PERMISSIONS: RolePermissions = buildPermissions('editar');
const BLANK_PERMISSIONS: RolePermissions = buildPermissions('none');

type PresetChoice = 'administrador' | 'agente' | 'em_branco';

const PRESET_ORDER: PresetChoice[] = ['agente', 'administrador', 'em_branco'];
const PRESET_LABELS: Record<PresetChoice, string> = {
  agente: 'Agente',
  administrador: 'Administrador',
  em_branco: 'Em branco',
};

function presetPermissions(preset: PresetChoice): RolePermissions {
  if (preset === 'administrador') return { ...ADMIN_PERMISSIONS };
  if (preset === 'agente') return { ...AGENT_ROLE_PRESET };
  return { ...BLANK_PERMISSIONS };
}

/** Merges a stored (possibly partial/legacy-shaped) permissions jsonb onto the full module set. */
function normalizePermissions(raw: Record<string, string> | null | undefined): RolePermissions {
  const merged = { ...BLANK_PERMISSIONS };
  for (const mod of PERMISSION_MODULES) {
    const value = raw?.[mod];
    if (value === 'none' || value === 'ver' || value === 'editar') merged[mod] = value;
  }
  return merged;
}

/** "N editar · N ver · N sem acesso", omitting any segment with a zero count
 * (a role with no "ver" modules never shows "0 ver"). Used for every role's
 * one-line summary except Administrador, which has a fixed override string. */
function summarizePermissions(permissions: RolePermissions): string {
  let editar = 0;
  let ver = 0;
  let none = 0;
  for (const mod of PERMISSION_MODULES) {
    const level = permissions[mod];
    if (level === 'editar') editar += 1;
    else if (level === 'ver') ver += 1;
    else none += 1;
  }
  const parts: string[] = [];
  if (editar > 0) parts.push(`${editar} editar`);
  if (ver > 0) parts.push(`${ver} ver`);
  if (none > 0) parts.push(`${none} sem acesso`);
  return parts.join(' · ');
}

/** Fixed summary for Administrador — real Financeiro access varies per admin
 * (their own "Ver financeiro" switch on the Equipe tab), so a computed count
 * would be misleading; the mockup calls this out explicitly instead. */
const ADMIN_SUMMARY = 'Edita tudo · Financeiro conforme o acesso de cada admin';

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
      return 'Você não tem permissão para gerenciar papéis.';
    case 'invalid_name':
      return 'Informe um nome para o papel.';
    case 'invalid_permissions':
      return 'Permissões inválidas.';
    case 'duplicate_name':
      return 'Já existe um papel com este nome.';
    case 'role_in_use':
      return 'Reatribua os membros antes de excluir este papel.';
    case 'role_not_found':
      return 'Este papel não existe mais.';
    default:
      return 'Algo deu errado. Tente novamente.';
  }
}

interface RoleFormState {
  roleId: string | null;
  nome: string;
  permissions: RolePermissions;
  preset: PresetChoice;
}

/** Text override for one module's chip, e.g. the Administrador card's
 * Financeiro chip (real access varies per admin, not a fixed level). */
type PermissionOverrides = Partial<Record<PermissionModule, string>>;

/** Financeiro access for a restricted admin depends on that member's own "Ver
 * financeiro" switch (Equipe tab) — never a fixed level, so the read-only
 * Administrador card must not claim one. */
const ADMIN_PERMISSION_OVERRIDES: PermissionOverrides = {
  financeiro: 'Conforme o acesso financeiro de cada admin',
};

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
              {LEVEL_LABELS[level]}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {entries.map((entry) =>
                entry.override ? (
                  <PermissionChip key={entry.mod} variant="cond">
                    {entry.override}
                  </PermissionChip>
                ) : (
                  <PermissionChip key={entry.mod} variant={level}>
                    {MODULE_LABELS[entry.mod]}
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
                  Padrão do sistema
                </Badge>
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {memberCount === 1 ? '1 membro' : `${memberCount} membros`}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{summary}</span>
          </div>
        </button>
        {!isSystem && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Button size="sm" variant="outline" onClick={onEdit}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
              Excluir
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
  return (
    <span
      style={{
        fontSize: '0.62rem',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-color)',
        borderRadius: 5,
        padding: '1px 5px',
        marginLeft: 7,
        fontWeight: 600,
        verticalAlign: 1,
        display: 'inline-block',
      }}
    >
      servidor
    </span>
  );
}

function segmentItemStyle(
  level: PermissionLevel,
  active: boolean,
  isFirst: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 0,
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.3rem 0.7rem',
    borderLeft: isFirst ? 'none' : '1px solid var(--border-color)',
  };
  if (!active) {
    return { ...base, background: 'var(--card-bg)', color: 'var(--text-muted)' };
  }
  if (level === 'none') {
    return { ...base, background: 'var(--surface-2)', color: 'var(--text-main)' };
  }
  if (level === 'ver') {
    return {
      ...base,
      background: 'var(--card-bg)',
      color: 'var(--text-main)',
      boxShadow: 'inset 0 0 0 2px var(--text-main)',
    };
  }
  return { ...base, background: 'var(--text-main)', color: 'var(--card-bg)' };
}

/** 3-state segmented control (Sem acesso / Ver / Editar) replacing the old
 * per-module Select — one click per module, every state visible at once.
 * Built on the same Radix ToggleGroup used by PlatformSelector, which gives
 * radiogroup semantics (role="radio" per item) and keyboard nav for free. */
function LevelSegmented({
  mod,
  value,
  onChange,
}: {
  mod: PermissionModule;
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
}) {
  const levels: PermissionLevel[] = ['none', 'ver', 'editar'];
  const handleChange = (next: string) => {
    if (!next || next === value) return;
    onChange(next as PermissionLevel);
  };
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={handleChange}
      aria-label={`Nível de acesso para ${MODULE_LABELS[mod]}`}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-color)',
        borderRadius: 999,
        overflow: 'hidden',
        gap: 0,
        flexShrink: 0,
      }}
    >
      {levels.map((level, i) => (
        <ToggleGroupItem
          key={level}
          value={level}
          style={segmentItemStyle(level, value === level, i === 0)}
        >
          {LEVEL_SEGMENT_LABELS[level]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Owner-only "Papéis" tab: system presets (read-only) + CRUD of custom papéis. */
export default function PapeisTab() {
  const { workspaceRole } = useAuth();
  const isOwner = workspaceRole === 'owner';
  const queryClient = useQueryClient();

  const { data: roles } = useQuery({
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
      toast.success('Papel criado!');
    },
    onError: (err: unknown) => toast.error(roleErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { roleId: string; nome: string; permissions: RolePermissions }) =>
      updateWorkspaceRole(vars.roleId, vars.nome, vars.permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles'] });
      closeDialog();
      toast.success('Papel atualizado!');
    },
    onError: (err: unknown) => toast.error(roleErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => deleteWorkspaceRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles'] });
      setDeleteTarget(null);
      toast.success('Papel excluído.');
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
      toast.error('Informe um nome para o papel.');
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
          <h3 className="config-title">Papéis</h3>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" /> Novo papel
          </Button>
        </div>

        <RoleRow
          nome="Administrador"
          isSystem
          memberCount={0}
          permissions={ADMIN_PERMISSIONS}
          summary={ADMIN_SUMMARY}
          permissionOverrides={ADMIN_PERMISSION_OVERRIDES}
        />
        <RoleRow
          nome="Agente"
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
        <DialogContent style={{ maxWidth: 660, maxHeight: '85vh', overflowY: 'auto' }}>
          <DialogHeader>
            <DialogTitle>{form?.roleId ? 'Editar papel' : 'Criar papel'}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="papeis-nome">Nome</Label>
                <Input
                  id="papeis-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>

              {!form.roleId && (
                <div className="space-y-1">
                  <Label>Começar de</Label>
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
                          {PRESET_LABELS[preset]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {form.roleId && editingMemberCount > 0 && (
                <p role="alert" style={{ fontSize: '0.8rem', color: 'var(--warning)', margin: 0 }}>
                  As mudanças valem na hora para{' '}
                  {editingMemberCount === 1 ? 'o 1 membro' : `os ${editingMemberCount} membros`} com
                  este papel.
                </p>
              )}

              <div>
                {MODULE_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div
                      className="papeis-form-group-label"
                      style={{
                        fontSize: '0.68rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--text-light)',
                        fontWeight: 700,
                        margin: '1rem 0 0.2rem',
                      }}
                    >
                      {group.label}
                    </div>
                    {group.modules.map((mod) => (
                      <div
                        key={mod}
                        className="papeis-form-row"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.4rem 0',
                          borderBottom: '1px solid var(--border-color)',
                        }}
                      >
                        <Label>
                          {MODULE_LABELS[mod]}
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
                ))}
              </div>

              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                Módulos com selo &quot;servidor&quot; são aplicados no banco. Os demais são
                aplicados na interface do CRM.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />} {form?.roleId ? 'Salvar alterações' : 'Criar papel'}
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
            <AlertDialogTitle>Excluir papel &quot;{deleteTarget?.nome}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
