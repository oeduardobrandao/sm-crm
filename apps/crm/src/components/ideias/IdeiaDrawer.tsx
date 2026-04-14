import { useState } from 'react';
import { X, ExternalLink, Save, Loader2 } from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IdeiaStatusBadge } from './IdeiaStatusBadge';
import {
  updateIdeiaStatus,
  upsertIdeiaComentario,
  toggleIdeiaReaction,
  getMembros,
  type Ideia,
} from '@/store';
import { useAuth } from '@/context/AuthContext';
import { sanitizeUrl } from '@/utils/security';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_OPTIONS: { value: Ideia['status']; label: string }[] = [
  { value: 'nova', label: 'Nova' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'aprovada', label: 'Aprovada' },
  { value: 'descartada', label: 'Descartada' },
];

interface IdeiaDrawerProps {
  ideia: Ideia;
  queryKey: unknown[];
  onClose: () => void;
}

export function IdeiaDrawer({ ideia, queryKey, onClose }: IdeiaDrawerProps) {
  const qc = useQueryClient();
  const { profile } = useAuth();

  // Resolve the membros.id for the current logged-in user.
  // Profile only has the auth user_id (profile.id); membros.user_id links them.
  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  const membroId: number | undefined = membros.find((m: any) => m.user_id === profile?.id)?.id;

  const [statusSaving, setStatusSaving] = useState(false);
  const [comentario, setComentario] = useState(ideia.comentario_agencia ?? '');
  const [comentarioSaving, setComentarioSaving] = useState(false);
  const [reactionLoading, setReactionLoading] = useState<string | null>(null);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  async function handleStatusChange(newStatus: Ideia['status']) {
    setStatusSaving(true);
    try {
      await updateIdeiaStatus(ideia.id, newStatus);
      qc.invalidateQueries({ queryKey });
      toast.success('Status atualizado.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar status.');
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleSaveComentario() {
    if (!membroId) return;
    setComentarioSaving(true);
    try {
      await upsertIdeiaComentario(ideia.id, comentario, membroId);
      qc.invalidateQueries({ queryKey });
      toast.success('Comentário salvo.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar comentário.');
    } finally {
      setComentarioSaving(false);
    }
  }

  async function handleReaction(emoji: string) {
    if (!membroId) return;
    setReactionLoading(emoji);
    try {
      await toggleIdeiaReaction(ideia.id, membroId, emoji);
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro.');
    } finally {
      setReactionLoading(null);
    }
  }

  // Group reactions by emoji
  const reactionMap = new Map<string, { count: number; names: string[]; myReaction: boolean }>();
  for (const r of ideia.ideia_reactions) {
    const entry = reactionMap.get(r.emoji) ?? { count: 0, names: [], myReaction: false };
    entry.count++;
    entry.names.push(r.membros.nome);
    if (r.membro_id === membroId) entry.myReaction = true;
    reactionMap.set(r.emoji, entry);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white w-full max-w-lg h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-stone-100">
          <div className="flex-1 min-w-0">
            <div className="mb-1.5">
              <IdeiaStatusBadge status={ideia.status} />
            </div>
            <h2 className="font-semibold text-stone-900 text-base leading-snug">{ideia.titulo}</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {ideia.clientes.nome} · {formatDate(ideia.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Description */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Descrição</p>
            <p className="text-sm text-stone-700 whitespace-pre-wrap">{ideia.descricao}</p>
          </div>

          {/* Links */}
          {ideia.links.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Links de referência</p>
              <div className="space-y-1">
                {ideia.links.map((link, i) => (
                  <a
                    key={i}
                    href={sanitizeUrl(link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
                  >
                    <ExternalLink size={12} />
                    {link.length > 55 ? link.slice(0, 55) + '…' : link}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Status */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">Status</p>
            <Select
              value={ideia.status}
              onValueChange={(v) => handleStatusChange(v as Ideia['status'])}
              disabled={statusSaving}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reactions */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Reações</p>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_EMOJI.map(emoji => {
                const entry = reactionMap.get(emoji);
                const active = entry?.myReaction ?? false;
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    disabled={reactionLoading === emoji}
                    title={entry?.names.join(', ') ?? ''}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all ${
                      active
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-200 hover:border-stone-400 bg-white text-stone-700'
                    }`}
                  >
                    {reactionLoading === emoji ? <Loader2 size={13} className="animate-spin" /> : emoji}
                    {entry && <span className="font-medium text-[12px]">{entry.count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Agency comment */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1.5">
              Resposta da agência
              {ideia.comentario_at && (
                <span className="ml-1.5 normal-case tracking-normal text-stone-300 font-normal">
                  — editado em {formatDate(ideia.comentario_at)}
                  {ideia.comentario_autor && ` por ${ideia.comentario_autor.nome}`}
                </span>
              )}
            </p>
            <textarea
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-900/20 resize-none min-h-[90px]"
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Escreva uma resposta para o cliente..."
            />
            <Button
              size="sm"
              className="mt-2"
              onClick={handleSaveComentario}
              disabled={comentarioSaving}
            >
              {comentarioSaving && <Loader2 size={13} className="animate-spin mr-1.5" />}
              <Save size={13} className="mr-1.5" />
              Salvar comentário
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
