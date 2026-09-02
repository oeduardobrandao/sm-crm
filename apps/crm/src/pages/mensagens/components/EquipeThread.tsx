import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Paperclip, Send, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { MentionText } from '@/components/mentions/MentionText';
import { useAuth } from '@/context/AuthContext';
import {
  validateEquipeChatFile,
  uploadEquipeChatAnexo,
  signEquipeChatAnexoView,
} from '@/services/equipeChatMedia';
import type { EquipeConversa, EquipeMensagemAnexo } from '@/store';
import { initialsOf } from './Avatars';
import { formatTime } from '../mensagensLogic';
import type { useEquipeChatData } from '../hooks/useEquipeChatData';

type EquipeData = ReturnType<typeof useEquipeChatData>;

interface EquipeThreadProps {
  conversa: EquipeConversa;
  mensagens: EquipeData['mensagens'];
  send: EquipeData['send'];
  markSeen: EquipeData['markSeen'];
  /** Provided on mobile only — shows the back arrow and returns to /mensagens/equipe. */
  onBack?: () => void;
  /** Opens the conversation-details sheet (Task 11). Optional and unused until then. */
  onOpenDetalhes?: () => void;
}

const HEADER_AVATAR = { width: 40, height: 40, fontSize: '0.8rem', flexShrink: 0 } as const;
const BUBBLE_AVATAR = { width: 28, height: 28, fontSize: '0.65rem', flexShrink: 0 } as const;

function anexoSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Image attachment thumbnail: signs its view URL on demand (cached 8min —
 * presigned URLs live longer than that, so a re-render inside the window
 * reuses the same one instead of re-signing). */
function AnexoImagem({ anexo }: { anexo: EquipeMensagemAnexo }) {
  const { data: url, isError } = useQuery({
    queryKey: ['equipe-anexo-url', anexo.id],
    queryFn: () => signEquipeChatAnexoView(anexo.id),
    staleTime: 8 * 60_000,
  });
  return (
    <img
      data-testid="anexo-imagem"
      className="mt-1 max-h-56 rounded-lg"
      style={{ cursor: 'pointer' }}
      src={url}
      alt={anexo.file_name}
      onClick={() => {
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        // Mirrors AnexoChip's error handling: same toast when the signed URL
        // is unavailable because signing failed. Still-loading is a silent
        // no-op, same as before.
        if (isError) toast.error('Não foi possível abrir o arquivo.');
      }}
    />
  );
}

/** Non-image attachment (PDF, ZIP): signs its URL only when clicked. */
function AnexoChip({ anexo }: { anexo: EquipeMensagemAnexo }) {
  async function abrir() {
    try {
      const url = await signEquipeChatAnexoView(anexo.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Não foi possível abrir o arquivo.');
    }
  }
  return (
    <button
      onClick={() => void abrir()}
      className="mt-1 flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 text-xs"
      style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
    >
      <FileText size={14} />
      <span className="max-w-[160px] truncate">{anexo.file_name}</span>
      <span className="text-[var(--text-muted)]">{anexoSizeLabel(anexo.size_bytes)}</span>
    </button>
  );
}

export function EquipeThread({
  conversa,
  mensagens,
  send,
  markSeen,
  onBack,
  onOpenDetalhes,
}: EquipeThreadProps) {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const [draft, setDraft] = useState('');
  const [anexosPendentes, setAnexosPendentes] = useState<EquipeMensagemAnexo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Same rationale as ConversationThread: starts true so the first settled
  // render snaps to the newest message; "Carregar mensagens anteriores"
  // never sets it, so loading older pages doesn't force a snap-to-bottom.
  const scrollPending = useRef(true);

  const itens = useMemo(() => {
    const all = (mensagens.data?.pages ?? []).flat();
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  }, [mensagens.data]);

  useEffect(() => {
    if (!scrollPending.current || mensagens.isLoading) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPending.current = false;
    }
  }, [mensagens.isLoading, itens.length]);

  // High-water mark: marca lido o maior id RENDERIZADO. Re-marca a cada
  // mensagem nova (realtime invalida -> itens muda).
  const maiorId = itens.length > 0 ? itens[itens.length - 1].id : 0;
  useEffect(() => {
    if (maiorId > 0) markSeen.mutate(maiorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maiorId, conversa.conversa_id]);

  async function anexar(file: File) {
    const erro = validateEquipeChatFile(file);
    if (erro) {
      toast.error(erro);
      return;
    }
    setUploading(true);
    try {
      const anexo = await uploadEquipeChatAnexo(conversa.conversa_id, file);
      setAnexosPendentes((prev) => [...prev, anexo]);
    } catch {
      toast.error('Não foi possível enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  }

  async function enviar() {
    const text = draft.trim();
    if ((!text && anexosPendentes.length === 0) || send.isPending || uploading) return;
    try {
      await send.mutateAsync({
        content: text,
        anexoIds: anexosPendentes.length > 0 ? anexosPendentes.map((a) => a.id) : undefined,
      });
      setDraft('');
      setAnexosPendentes([]);
      scrollPending.current = true;
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden mensagens-thread-root">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar para as conversas"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft size={17} />
          </button>
        )}
        {conversa.tipo === 'dm' && conversa.avatar_url ? (
          <img
            src={conversa.avatar_url}
            alt=""
            className="avatar"
            style={{ ...HEADER_AVATAR, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <span
            className="avatar"
            style={{
              ...HEADER_AVATAR,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            {conversa.tipo === 'grupo' ? <Users size={18} /> : initialsOf(conversa.display_nome)}
          </span>
        )}
        <span className="flex-1 truncate text-sm font-semibold">{conversa.display_nome}</span>
        {onOpenDetalhes && (
          <button
            onClick={onOpenDetalhes}
            aria-label="Ver detalhes da conversa"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <Users size={15} />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        data-testid="thread-scroll"
        className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-4"
        style={{ background: 'var(--bg-color)' }}
      >
        {mensagens.hasNextPage && (
          <button
            onClick={() => mensagens.fetchNextPage()}
            disabled={mensagens.isFetchingNextPage}
            className="self-center text-xs font-semibold text-[var(--text-muted)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {mensagens.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {mensagens.isError && (
          <div className="flex flex-col items-center gap-2 self-center py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Não foi possível carregar as mensagens.
            </p>
            <button
              onClick={() => mensagens.refetch()}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!mensagens.isError && mensagens.isLoading && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {!mensagens.isError && !mensagens.isLoading && itens.length === 0 && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        )}
        {itens.map((m) => {
          const minha = m.author_user_id === meuId;
          return (
            <div
              key={m.id}
              data-testid={`equipe-msg-${m.id}`}
              className={`flex max-w-[78%] items-end gap-2 ${minha ? 'flex-row-reverse self-end' : 'self-start'}`}
            >
              {m.author_avatar_url ? (
                <img src={m.author_avatar_url} alt="" className="avatar" style={BUBBLE_AVATAR} />
              ) : (
                <span className="avatar" style={BUBBLE_AVATAR} aria-hidden="true">
                  {initialsOf(m.author_name)}
                </span>
              )}
              <div className={`flex flex-col gap-1 ${minha ? 'items-end' : 'items-start'}`}>
                <div
                  className="rounded-2xl px-3.5 py-2.5 text-sm"
                  style={{
                    background: minha ? 'var(--surface-hover)' : 'var(--card-bg)',
                    boxShadow: 'inset 0 0 0 1px var(--border-color)',
                  }}
                >
                  {!minha && (
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {m.author_name}
                    </div>
                  )}
                  {m.content && (
                    <p className="whitespace-pre-wrap">
                      <MentionText text={m.content} />
                    </p>
                  )}
                  {m.anexos.map((a) =>
                    a.mime_type.startsWith('image/') ? (
                      <AnexoImagem key={a.id} anexo={a} />
                    ) : (
                      <AnexoChip key={a.id} anexo={a} />
                    ),
                  )}
                </div>
                <span className="text-[11px] text-[var(--text-light)]">
                  {formatTime(m.created_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--border-color)] p-3.5">
        {anexosPendentes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {anexosPendentes.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-xs"
              >
                <Paperclip size={12} />
                <span className="max-w-[160px] truncate">{a.file_name}</span>
                <button
                  onClick={() => setAnexosPendentes((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label={`Remover ${a.file_name}`}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void anexar(f);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Anexar arquivo"
            className="rounded-full border border-[var(--border-color)] p-2.5 text-[var(--text-muted)] disabled:opacity-50"
            style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
          >
            <Paperclip size={15} />
          </button>
          <MentionTextarea
            rows={1}
            value={draft}
            onValueChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Mensagem para a equipe…"
            className="flex-1 resize-none rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={() => void enviar()}
            disabled={
              send.isPending || uploading || (!draft.trim() && anexosPendentes.length === 0)
            }
            aria-label="Enviar mensagem"
            className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50 bg-[var(--primary-color)]"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
