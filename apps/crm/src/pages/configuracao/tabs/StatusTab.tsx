import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Archive, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
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
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { CUSTOM_STATUS_ICONS, getCustomStatusIcon } from '@/pages/entregas/statusIcons';
import { useAuth } from '../../../context/AuthContext';
import { handleEntitlementMutationError } from '../../../lib/entitlement-toast';
import {
  getPostStatusDefinitions,
  createPostStatusDefinition,
  updatePostStatusDefinition,
  archivePostStatusDefinition,
  getPostStatusAutomations,
  createPostStatusAutomation,
  updatePostStatusAutomation,
  deletePostStatusAutomation,
  getMembros,
  type PostStatusDefinition,
  type PostStatusAutomation,
  type CustomStatusBehavesAs,
  type WorkflowPost,
} from '../../../store';
import { STATUS_LABELS, POST_STATUS_ORDER } from '../../entregas/postLabels';

const BEHAVES_AS_OPTIONS: CustomStatusBehavesAs[] = [
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
];

const PRESET_COLORS = [
  '#94a3b8',
  '#7c5cff',
  '#0ea5b7',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
];

/** Query key shared with useStatusRegistry so every surface refreshes together. */
const DEFS_KEY = ['post-status-definitions'];

export default function StatusTab() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [pendingArchive, setPendingArchive] = useState<PostStatusDefinition | null>(null);

  const { data: defs = [], isLoading } = useQuery({
    queryKey: DEFS_KEY,
    queryFn: () => getPostStatusDefinitions(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: DEFS_KEY });

  const onMutationError = (err: unknown, fallback: string) => {
    // The plan gate raises feature_disabled from a DB trigger on a direct
    // PostgREST write — no edge function nor MutationCache sees it, so this
    // catch is the only observation point (same as PropertyDefinitionPanel).
    if (!handleEntitlementMutationError(err, profile?.conta_id ?? null)) toast.error(fallback);
  };

  const createMutation = useMutation({
    // Ordem after the current MAX, not defs.length: archived rows keep their
    // ordem, so a count-based value could collide with a live row and land
    // the new status mid-list.
    mutationFn: (payload: {
      nome: string;
      cor: string;
      icone: string | null;
      behaves_as: CustomStatusBehavesAs;
    }) =>
      createPostStatusDefinition({
        ...payload,
        ordem: defs.reduce((max, d) => Math.max(max, d.ordem), -1) + 1,
      }),
    onSuccess: () => {
      toast.success('Status criado!');
      invalidate();
    },
    onError: (err) => onMutationError(err, 'Erro ao criar status'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: { id: string } & Parameters<typeof updatePostStatusDefinition>[1]) =>
      updatePostStatusDefinition(id, payload),
    onSuccess: invalidate,
    onError: (err) => onMutationError(err, 'Erro ao atualizar status'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archivePostStatusDefinition(id),
    onSuccess: () => {
      toast.success('Status arquivado. Os posts voltaram ao status padrão.');
      invalidate();
    },
    onError: (err) => onMutationError(err, 'Erro ao arquivar status'),
  });

  // Serialized: buttons disable while a swap is in flight, so two quick
  // clicks can't interleave the two ordem writes and duplicate values.
  const [reordering, setReordering] = useState(false);
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= defs.length || reordering) return;
    const a = defs[index];
    const b = defs[target];
    setReordering(true);
    try {
      await updatePostStatusDefinition(a.id, {
        ordem: b.ordem === a.ordem ? b.ordem + dir : b.ordem,
      });
      await updatePostStatusDefinition(b.id, { ordem: a.ordem });
      await invalidate();
    } catch (err) {
      onMutationError(err, 'Erro ao reordenar');
    } finally {
      setReordering(false);
    }
  };

  return (
    <div>
      <section className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Status personalizados</h3>
        <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Crie etapas próprias para os posts. Cada status se comporta como um status padrão: é isso
          que define visibilidade no Hub do cliente, publicação e contagens. O nome personalizado
          aparece só para a equipe.
        </p>

        {isLoading ? (
          <Spinner size="sm" />
        ) : defs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Nenhum status personalizado ainda.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {defs.map((def, i) => (
              <div
                key={def.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px 1fr 220px auto',
                  gap: 10,
                  alignItems: 'center',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: '8px 10px',
                }}
              >
                {(() => {
                  const DefIcon = getCustomStatusIcon(def.icone);
                  return DefIcon ? (
                    <DefIcon
                      size={16}
                      aria-hidden="true"
                      style={{ color: def.cor, flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      title={def.cor}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        background: def.cor,
                        display: 'inline-block',
                      }}
                    />
                  );
                })()}
                <strong style={{ fontSize: '0.9rem' }}>{def.nome}</strong>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  Se comporta como
                  <select
                    className="drawer-select"
                    value={def.behaves_as}
                    onChange={(e) =>
                      updateMutation.mutate({
                        id: def.id,
                        behaves_as: e.target.value as CustomStatusBehavesAs,
                      })
                    }
                  >
                    {BEHAVES_AS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Subir"
                    disabled={i === 0 || reordering}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Descer"
                    disabled={i === defs.length - 1 || reordering}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Arquivar"
                    onClick={() => setPendingArchive(def)}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <FeatureGate flag="feature_custom_properties" label="Status personalizados">
            <CreateStatusForm
              onCreate={(payload) => createMutation.mutate(payload)}
              creating={createMutation.isPending}
            />
          </FeatureGate>
        </div>
      </section>

      <AutomationsSection defs={defs} onMutationError={onMutationError} />

      <AlertDialog
        open={!!pendingArchive}
        onOpenChange={(open) => !open && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar "{pendingArchive?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Os posts que estão nesse status voltarão ao status padrão correspondente (
              {pendingArchive ? STATUS_LABELS[pendingArchive.behaves_as] : ''}). O histórico dos
              posts mantém o nome antigo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingArchive) archiveMutation.mutate(pendingArchive.id);
                setPendingArchive(null);
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateStatusForm({
  onCreate,
  creating,
}: {
  onCreate: (payload: {
    nome: string;
    cor: string;
    icone: string | null;
    behaves_as: CustomStatusBehavesAs;
  }) => void;
  creating: boolean;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(PRESET_COLORS[1]);
  const [icone, setIcone] = useState<string | null>(null);
  const [behavesAs, setBehavesAs] = useState<CustomStatusBehavesAs>('revisao_interna');

  const submit = () => {
    const trimmed = nome.trim();
    if (!trimmed) {
      toast.error('Dê um nome ao status');
      return;
    }
    onCreate({ nome: trimmed, cor, icone, behaves_as: behavesAs });
    setNome('');
  };

  return (
    <div
      style={{
        border: '1px dashed var(--border-color)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="drawer-input"
          style={{ flex: 1, minWidth: 180, maxWidth: 420 }}
          placeholder="Nome do status (ex.: Em design)"
          value={nome}
          maxLength={40}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          Se comporta como
          <select
            className="drawer-select"
            value={behavesAs}
            onChange={(e) => setBehavesAs(e.target.value as CustomStatusBehavesAs)}
          >
            {BEHAVES_AS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          title="Sem ícone (dot de cor)"
          onClick={() => setIcone(null)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-hover)',
            border: icone === null ? '2px solid var(--text-main)' : '2px solid transparent',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: cor }} />
        </button>
        {Object.entries(CUSTOM_STATUS_ICONS).map(([name, IconCmp]) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() => setIcone(name)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-hover)',
              border: icone === name ? '2px solid var(--text-main)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            <IconCmp size={14} aria-hidden="true" style={{ color: cor }} />
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setCor(c)}
              style={{
                width: 18,
                height: 18,
                borderRadius: 6,
                background: c,
                border: cor === c ? '2px solid var(--text-main)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
        <Button size="sm" onClick={submit} disabled={creating} style={{ marginLeft: 'auto' }}>
          <Plus className="h-3.5 w-3.5" /> Novo status
        </Button>
      </div>
    </div>
  );
}

// ── Automações ────────────────────────────────────────────────────────────────

const AUTOMATIONS_KEY = ['post-status-automations'];

/** 'canonical:<status>' | 'custom:<uuid>' — local select encoding. */
type TriggerValue = string;

const triggerValueOf = (a: PostStatusAutomation): TriggerValue =>
  a.trigger_custom_status_id
    ? `custom:${a.trigger_custom_status_id}`
    : `canonical:${a.trigger_status}`;

function triggerPatch(value: TriggerValue) {
  return value.startsWith('custom:')
    ? { trigger_status: null, trigger_custom_status_id: value.slice('custom:'.length) }
    : {
        trigger_status: value.slice('canonical:'.length) as WorkflowPost['status'],
        trigger_custom_status_id: null,
      };
}

function AutomationsSection({
  defs,
  onMutationError,
}: {
  defs: PostStatusDefinition[];
  onMutationError: (err: unknown, fallback: string) => void;
}) {
  const qc = useQueryClient();

  const { data: automations = [], isLoading } = useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: getPostStatusAutomations,
  });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });

  const invalidate = () => qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });

  const createMutation = useMutation({
    mutationFn: createPostStatusAutomation,
    onSuccess: () => {
      toast.success('Automação criada!');
      invalidate();
    },
    onError: (err) => onMutationError(err, 'Erro ao criar automação'),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      updatePostStatusAutomation(id, { ativo }),
    onSuccess: invalidate,
    onError: (err) => onMutationError(err, 'Erro ao atualizar automação'),
  });
  const deleteMutation = useMutation({
    mutationFn: deletePostStatusAutomation,
    onSuccess: invalidate,
    onError: (err) => onMutationError(err, 'Erro ao remover automação'),
  });

  const triggerLabel = (a: PostStatusAutomation): string => {
    if (a.trigger_custom_status_id) {
      const def = defs.find((d) => d.id === a.trigger_custom_status_id);
      return def ? `· ${def.nome}` : 'Status removido';
    }
    return a.trigger_status ? STATUS_LABELS[a.trigger_status] : '';
  };

  const actionLabel = (a: PostStatusAutomation): string => {
    if (a.action_type === 'assign_responsavel') {
      const membroId = 'membro_id' in a.config ? a.config.membro_id : null;
      const membro = membros.find((m) => m.id === membroId);
      return `Atribuir a ${membro?.nome ?? 'membro removido'}`;
    }
    const cfg = a.config as { target?: string; membro_id?: number };
    if (cfg.target === 'member') {
      const membro = membros.find((m) => m.id === cfg.membro_id);
      return `Notificar ${membro?.nome ?? 'membro removido'}`;
    }
    if (cfg.target === 'roles') return 'Notificar owners e admins';
    return 'Notificar o responsável do post';
  };

  return (
    <section className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="config-title">Automações por status</h3>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Quando um post entrar em um status (padrão ou personalizado), rode uma ação. Se um post
        entrar em um personalizado, regras do status padrão equivalente também disparam. Ao agendar
        ou publicar, o sistema move o post sozinho e as regras desses status disparam normalmente.
      </p>

      {isLoading ? (
        <Spinner size="sm" />
      ) : automations.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nenhuma automação ainda.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {automations.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto auto',
                gap: 10,
                alignItems: 'center',
                border: '1px solid var(--border-color)',
                borderRadius: 10,
                padding: '8px 10px',
                fontSize: '0.85rem',
                opacity: a.ativo ? 1 : 0.55,
              }}
            >
              <span>
                Quando entrar em <strong>{triggerLabel(a)}</strong>
              </span>
              <span>{actionLabel(a)}</span>
              <Switch
                checked={a.ativo}
                onCheckedChange={(ativo) => toggleMutation.mutate({ id: a.id, ativo })}
                title={a.ativo ? 'Ativa' : 'Inativa'}
              />
              <Button
                variant="outline"
                size="icon"
                title="Remover"
                onClick={() => deleteMutation.mutate(a.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <FeatureGate flag="feature_custom_properties" label="Automações por status">
          <CreateAutomationForm
            defs={defs}
            membros={membros}
            onCreate={(payload) => createMutation.mutate(payload)}
            creating={createMutation.isPending}
          />
        </FeatureGate>
      </div>
    </section>
  );
}

function CreateAutomationForm({
  defs,
  membros,
  onCreate,
  creating,
}: {
  defs: PostStatusDefinition[];
  membros: { id?: number; nome: string }[];
  onCreate: (payload: Parameters<typeof createPostStatusAutomation>[0]) => void;
  creating: boolean;
}) {
  const [trigger, setTrigger] = useState<TriggerValue>('canonical:correcao_cliente');
  const [action, setAction] = useState<'notify' | 'assign_responsavel'>('notify');
  const [notifyTarget, setNotifyTarget] = useState<'responsavel' | 'roles' | 'member'>(
    'responsavel',
  );
  const [membroId, setMembroId] = useState<number | ''>('');

  const needsMembro = action === 'assign_responsavel' || notifyTarget === 'member';

  const submit = () => {
    if (needsMembro && membroId === '') {
      toast.error('Escolha um membro');
      return;
    }
    const config =
      action === 'assign_responsavel'
        ? { membro_id: membroId as number }
        : notifyTarget === 'member'
          ? { target: 'member' as const, membro_id: membroId as number }
          : notifyTarget === 'roles'
            ? { target: 'roles' as const, roles: ['owner', 'admin'] }
            : { target: 'responsavel' as const };
    onCreate({ ...triggerPatch(trigger), action_type: action, config });
  };

  return (
    <div
      style={{
        border: '1px dashed var(--border-color)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
        fontSize: '0.85rem',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Quando entrar em
        <select
          className="drawer-select"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
        >
          {POST_STATUS_ORDER.flatMap((status) => [
            <option key={status} value={`canonical:${status}`}>
              {STATUS_LABELS[status]}
            </option>,
            ...defs
              .filter((d) => d.behaves_as === status)
              .map((d) => (
                <option key={d.id} value={`custom:${d.id}`}>
                  {`· ${d.nome}`}
                </option>
              )),
          ])}
        </select>
      </label>
      <select
        className="drawer-select"
        value={action}
        onChange={(e) => setAction(e.target.value as typeof action)}
      >
        <option value="notify">Notificar</option>
        <option value="assign_responsavel">Atribuir responsável</option>
      </select>
      {action === 'notify' && (
        <select
          className="drawer-select"
          value={notifyTarget}
          onChange={(e) => setNotifyTarget(e.target.value as typeof notifyTarget)}
        >
          <option value="responsavel">Responsável do post</option>
          <option value="roles">Owners e admins</option>
          <option value="member">Membro específico</option>
        </select>
      )}
      {needsMembro && (
        <select
          className="drawer-select"
          value={membroId}
          onChange={(e) => setMembroId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Escolha o membro…</option>
          {membros
            .filter((m) => m.id != null)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
        </select>
      )}
      <Button size="sm" onClick={submit} disabled={creating} style={{ marginLeft: 'auto' }}>
        <Plus className="h-3.5 w-3.5" /> Nova automação
      </Button>
    </div>
  );
}
