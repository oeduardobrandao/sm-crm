import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: 'Sem acesso',
  ver: 'Pode ver',
  editar: 'Pode editar',
};

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

/** Text override for one module's value row, e.g. the Administrador card's
 * Financeiro row (real access varies per admin, not a fixed level). */
type PermissionOverrides = Partial<Record<PermissionModule, string>>;

function PermissionsGrid({
  permissions,
  overrides,
}: {
  permissions: RolePermissions;
  overrides?: PermissionOverrides;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.3rem 1.5rem',
        fontSize: '0.78rem',
        marginTop: '0.5rem',
      }}
    >
      {PERMISSION_MODULES.map((mod) => {
        const override = overrides?.[mod];
        return (
          <div
            key={mod}
            style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>{MODULE_LABELS[mod]}</span>
            <span style={override ? { color: 'var(--text-muted)' } : { fontWeight: 500 }}>
              {override ?? LEVEL_LABELS[permissions[mod]]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RoleCard({
  nome,
  isSystem,
  memberCount,
  permissions,
  permissionOverrides,
  onEdit,
  onDelete,
}: {
  nome: string;
  isSystem: boolean;
  memberCount: number;
  permissions: RolePermissions;
  permissionOverrides?: PermissionOverrides;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="config-member-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
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
      <PermissionsGrid permissions={permissions} overrides={permissionOverrides} />
    </div>
  );
}

/** Financeiro access for a restricted admin depends on that member's own "Ver
 * financeiro" switch (Equipe tab) — never a fixed level, so the read-only
 * Administrador card must not claim one. */
const ADMIN_PERMISSION_OVERRIDES: PermissionOverrides = {
  financeiro: 'Conforme o acesso financeiro de cada admin',
};

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

        <RoleCard
          nome="Administrador"
          isSystem
          memberCount={0}
          permissions={ADMIN_PERMISSIONS}
          permissionOverrides={ADMIN_PERMISSION_OVERRIDES}
        />
        <RoleCard nome="Agente" isSystem memberCount={0} permissions={AGENT_ROLE_PRESET} />

        {customRoles.map((role) => (
          <RoleCard
            key={role.id}
            nome={role.nome}
            isSystem={false}
            memberCount={memberCounts?.[role.id] ?? 0}
            permissions={normalizePermissions(role.permissions)}
            onEdit={() => openEditDialog(role)}
            onDelete={() => setDeleteTarget(role)}
          />
        ))}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent style={{ maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }}>
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
                  <Label>Começar a partir de</Label>
                  <Select
                    value={form.preset}
                    onValueChange={(v) => handlePresetChange(v as PresetChoice)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="administrador">Administrador</SelectItem>
                      <SelectItem value="agente">Agente</SelectItem>
                      <SelectItem value="em_branco">Em branco</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.roleId && editingMemberCount > 0 && (
                <p role="alert" style={{ fontSize: '0.8rem', color: 'var(--warning)', margin: 0 }}>
                  As mudanças valem na hora para os membros com este papel.
                </p>
              )}

              <div>
                {PERMISSION_MODULES.map((mod) => (
                  <div
                    key={mod}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.4rem 0',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <Label>{MODULE_LABELS[mod]}</Label>
                    <Select
                      value={form.permissions[mod]}
                      onValueChange={(v) => handleLevelChange(mod, v as PermissionLevel)}
                    >
                      <SelectTrigger style={{ width: 170, flexShrink: 0 }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem acesso</SelectItem>
                        <SelectItem value="ver">Pode ver</SelectItem>
                        <SelectItem value="editar">Pode editar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                Financeiro, Contratos, Leads, Automações e Configurações são aplicados no servidor.
                Os demais módulos são aplicados na interface do CRM.
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
