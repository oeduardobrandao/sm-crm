import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { getEquipeChatMembers, createEquipeConversa } from '@/store';
import { initialsOf } from './Avatars';

interface NovaConversaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversaId: number) => void;
}

const AVATAR = { width: 32, height: 32, fontSize: '0.7rem', flexShrink: 0 } as const;

/** Nova conversa (DM ou grupo). Modo 'lista': busca + colegas (clique abre
 * DM direto). Modo 'grupo' (so owner/admin): nome + multi-select + Criar. */
export function NovaConversaDialog({ open, onOpenChange, onCreated }: NovaConversaDialogProps) {
  const { user, workspaceRole } = useAuth();
  // workspaceRole (workspace_members for the ACTIVE workspace), not the
  // profile-derived `role`: `role` goes stale on workspace switch (see
  // AuthContext.tsx) -- nav-data.ts's Financeiro/Contratos gate already
  // documents the exact failure mode this avoids.
  const podeCriarGrupo = workspaceRole === 'owner' || workspaceRole === 'admin';
  const [modo, setModo] = useState<'lista' | 'grupo'>('lista');
  const [nome, setNome] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);

  const members = useQuery({
    queryKey: ['equipe-chat-members'],
    queryFn: getEquipeChatMembers,
    enabled: open,
  });
  const colegas = (members.data ?? []).filter((m) => m.user_id !== user?.id);
  const q = busca.trim().toLowerCase();
  const visiveis = q ? colegas.filter((m) => m.nome.toLowerCase().includes(q)) : colegas;

  function resetar() {
    setModo('lista');
    setNome('');
    setSelecionados([]);
    setBusca('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetar();
    onOpenChange(next);
  }

  async function abrirDm(userId: string) {
    if (enviando) return;
    setEnviando(true);
    try {
      const id = await createEquipeConversa('dm', null, [userId]);
      onCreated(id);
      handleOpenChange(false);
    } catch {
      toast.error('Não foi possível abrir a conversa.');
    } finally {
      setEnviando(false);
    }
  }

  function toggleSelecionado(userId: string) {
    setSelecionados((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  async function criarGrupo() {
    const n = nome.trim();
    if (!n || selecionados.length === 0 || enviando) return;
    setEnviando(true);
    try {
      const id = await createEquipeConversa('grupo', n, selecionados);
      onCreated(id);
      handleOpenChange(false);
    } catch {
      toast.error('Não foi possível criar o grupo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{modo === 'lista' ? 'Nova conversa' : 'Criar grupo'}</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha um colega para abrir uma conversa direta ou crie um grupo.
          </DialogDescription>
        </DialogHeader>

        {modo === 'lista' ? (
          <div className="flex flex-col gap-3">
            <div style={{ position: 'relative' }}>
              <Search
                className="h-4 w-4"
                style={{
                  position: 'absolute',
                  left: '0.625rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar colega..."
                aria-label="Buscar colega"
                style={{ paddingLeft: '2rem' }}
              />
            </div>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {members.isLoading && (
                <p className="py-6 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
              )}
              {!members.isLoading && visiveis.length === 0 && (
                <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                  Nenhum colega encontrado.
                </p>
              )}
              {visiveis.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  data-testid={`colega-dm-${m.user_id}`}
                  onClick={() => void abrirDm(m.user_id)}
                  disabled={enviando}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-50"
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  {m.avatar_url ? (
                    <img
                      src={m.avatar_url}
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
                      {initialsOf(m.nome)}
                    </span>
                  )}
                  <span className="text-sm font-medium">{m.nome}</span>
                </button>
              ))}
            </div>
            {podeCriarGrupo && (
              <Button type="button" variant="outline" onClick={() => setModo('grupo')}>
                <Users className="h-3.5 w-3.5 mr-1.5" /> Criar grupo
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do grupo"
              aria-label="Nome do grupo"
            />
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {colegas.map((m) => {
                const marcado = selecionados.includes(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    data-testid={`colega-toggle-${m.user_id}`}
                    aria-pressed={marcado}
                    onClick={() => toggleSelecionado(m.user_id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-hover)]"
                    style={{
                      border: 'none',
                      cursor: 'pointer',
                      background: marcado ? 'rgba(255,191,48,0.12)' : 'transparent',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
                      style={{
                        border: `1px solid ${marcado ? 'var(--primary-color)' : 'var(--border-color)'}`,
                        background: marcado ? 'var(--primary-color)' : 'transparent',
                      }}
                    >
                      {marcado && <Check size={12} />}
                    </span>
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
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
                        {initialsOf(m.nome)}
                      </span>
                    )}
                    <span className="text-sm font-medium">{m.nome}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setModo('lista')}>
                Voltar
              </Button>
              <Button
                type="button"
                onClick={() => void criarGrupo()}
                disabled={!nome.trim() || selecionados.length === 0 || enviando}
              >
                Criar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
