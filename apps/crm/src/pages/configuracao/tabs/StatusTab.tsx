import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Archive, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
import { useAuth } from '../../../context/AuthContext';
import { handleEntitlementMutationError } from '../../../lib/entitlement-toast';
import {
  getPostStatusDefinitions,
  createPostStatusDefinition,
  updatePostStatusDefinition,
  archivePostStatusDefinition,
  type PostStatusDefinition,
  type CustomStatusBehavesAs,
} from '../../../store';
import { STATUS_LABELS } from '../../entregas/postLabels';

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
    mutationFn: (payload: { nome: string; cor: string; behaves_as: CustomStatusBehavesAs }) =>
      createPostStatusDefinition({ ...payload, ordem: defs.length }),
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

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= defs.length) return;
    const a = defs[index];
    const b = defs[target];
    // Swap ordem values; two independent updates, both invalidate at the end.
    Promise.all([
      updatePostStatusDefinition(a.id, { ordem: b.ordem === a.ordem ? b.ordem + dir : b.ordem }),
      updatePostStatusDefinition(b.id, { ordem: a.ordem }),
    ])
      .then(invalidate)
      .catch((err) => onMutationError(err, 'Erro ao reordenar'));
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 720 }}>
      <section className="card" style={{ padding: '1.25rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Status personalizados</h3>
        <p style={{ margin: '0.35rem 0 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
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
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Descer"
                    disabled={i === defs.length - 1}
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
  onCreate: (payload: { nome: string; cor: string; behaves_as: CustomStatusBehavesAs }) => void;
  creating: boolean;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(PRESET_COLORS[1]);
  const [behavesAs, setBehavesAs] = useState<CustomStatusBehavesAs>('revisao_interna');

  const submit = () => {
    const trimmed = nome.trim();
    if (!trimmed) {
      toast.error('Dê um nome ao status');
      return;
    }
    onCreate({ nome: trimmed, cor, behaves_as: behavesAs });
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
          style={{ flex: 1, minWidth: 180 }}
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
