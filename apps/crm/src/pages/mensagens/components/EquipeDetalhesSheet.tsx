import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut, Pencil, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import {
  getEquipeChatMembers,
  getEquipeConversaParticipantes,
  manageEquipeConversa,
  type EquipeConversa,
} from '@/store';
import { initialsOf } from './Avatars';

interface EquipeDetalhesSheetProps {
  conversa: EquipeConversa;
  onClose: () => void;
  onLeft: () => void;
}

const AVATAR = { width: 32, height: 32, fontSize: '0.7rem', flexShrink: 0 } as const;
const PAPEL_LABELS: Record<string, string> = { owner: 'Dono', admin: 'Admin', agent: 'Agente' };

/** Detalhes de uma conversa de equipe. Grupo: nome + participantes (com
 * papel) + gestao (owner/admin: renomear/adicionar/remover; qualquer
 * participante: sair). DM: so mostra o colega, sem controles de gestao. */
export function EquipeDetalhesSheet({ conversa, onClose, onLeft }: EquipeDetalhesSheetProps) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const podeGerenciar = role === 'owner' || role === 'admin';
  const isGrupo = conversa.tipo === 'grupo';

  const [renomeando, setRenomeando] = useState(false);
  const [nomeEdit, setNomeEdit] = useState(conversa.nome ?? '');
  const [addUserId, setAddUserId] = useState('');

  const members = useQuery({
    queryKey: ['equipe-chat-members'],
    queryFn: getEquipeChatMembers,
  });
  const participantes = useQuery({
    queryKey: ['equipe-participantes', conversa.conversa_id],
    queryFn: () => getEquipeConversaParticipantes(conversa.conversa_id),
  });

  const membersById = useMemo(() => {
    const map = new Map<string, { nome: string; avatar_url: string | null; role: string }>();
    for (const m of members.data ?? []) map.set(m.user_id, m);
    return map;
  }, [members.data]);

  const participanteIds = participantes.data;

  const linhas = useMemo(
    () =>
      (participanteIds ?? [])
        .map((userId) => {
          const m = membersById.get(userId);
          return {
            user_id: userId,
            nome: m?.nome ?? 'Colega',
            avatar_url: m?.avatar_url ?? null,
            role: m?.role ?? null,
          };
        })
        .filter((p) => isGrupo || p.user_id !== user?.id),
    [participanteIds, membersById, isGrupo, user?.id],
  );

  const foraDoGrupo = (members.data ?? []).filter(
    (m) => !(participanteIds ?? []).includes(m.user_id),
  );

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['equipe-conversas'] });
    queryClient.invalidateQueries({ queryKey: ['equipe-participantes', conversa.conversa_id] });
  }

  const renameMutation = useMutation({
    mutationFn: (novoNome: string) =>
      manageEquipeConversa(conversa.conversa_id, 'rename', { nome: novoNome }),
    onSuccess: () => {
      invalidar();
      setRenomeando(false);
    },
    onError: () => toast.error('Não foi possível renomear o grupo.'),
  });

  const addMutation = useMutation({
    mutationFn: (userId: string) => manageEquipeConversa(conversa.conversa_id, 'add', { userId }),
    onSuccess: () => {
      invalidar();
      setAddUserId('');
    },
    onError: () => toast.error('Não foi possível adicionar o participante.'),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      manageEquipeConversa(conversa.conversa_id, 'remove', { userId }),
    onSuccess: invalidar,
    onError: () => toast.error('Não foi possível remover o participante.'),
  });

  const leaveMutation = useMutation({
    mutationFn: () => manageEquipeConversa(conversa.conversa_id, 'leave'),
    onSuccess: () => {
      invalidar();
      onLeft();
    },
    onError: () => toast.error('Não foi possível sair do grupo.'),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px] overflow-y-auto">
        <SheetHeader className="mb-4 pr-8">
          <SheetTitle className="text-left leading-snug">{conversa.display_nome}</SheetTitle>
          <SheetDescription className="sr-only">Detalhes da conversa</SheetDescription>
        </SheetHeader>

        {isGrupo && podeGerenciar && (
          <div className="mb-4 flex items-center gap-2">
            {renomeando ? (
              <>
                <Input
                  value={nomeEdit}
                  onChange={(e) => setNomeEdit(e.target.value)}
                  aria-label="Nome do grupo"
                  className="h-8 flex-1 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!nomeEdit.trim() || renameMutation.isPending}
                  onClick={() => renameMutation.mutate(nomeEdit.trim())}
                >
                  Salvar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRenomeando(false)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setNomeEdit(conversa.nome ?? '');
                  setRenomeando(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Renomear
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          {linhas.map((p) => (
            <div
              key={p.user_id}
              data-testid={`participante-${p.user_id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2"
            >
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  className="avatar"
                  style={{ ...AVATAR, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <span
                  className="avatar"
                  style={{
                    ...AVATAR,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-hidden="true"
                >
                  {initialsOf(p.nome)}
                </span>
              )}
              <span className="flex-1 text-sm font-medium">{p.nome}</span>
              {p.role && (
                <span className="text-xs text-[var(--text-muted)]">
                  {PAPEL_LABELS[p.role] ?? p.role}
                </span>
              )}
              {isGrupo && podeGerenciar && (
                <button
                  type="button"
                  aria-label={`Remover ${p.nome}`}
                  onClick={() => removeMutation.mutate(p.user_id)}
                  disabled={removeMutation.isPending}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {isGrupo && podeGerenciar && foraDoGrupo.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <select
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              aria-label="Adicionar participante"
              className="h-8 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-2 text-sm"
            >
              <option value="">Adicionar participante…</option>
              {foraDoGrupo.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.nome}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={!addUserId || addMutation.isPending}
              onClick={() => addMutation.mutate(addUserId)}
            >
              Adicionar
            </Button>
          </div>
        )}

        {isGrupo && (
          <div className="mt-6 border-t border-[var(--border-color)] pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              style={{ color: 'var(--danger-text)' }}
              onClick={() => leaveMutation.mutate()}
              disabled={leaveMutation.isPending}
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sair do grupo
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
