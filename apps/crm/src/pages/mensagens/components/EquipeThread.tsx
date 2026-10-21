import { ArrowLeft, Paperclip, Send, Users, X } from 'lucide-react';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { MentionText } from '@/components/mentions/MentionText';
import type { EquipeConversa } from '@/store';
import { initialsOf } from './Avatars';
import { AnexoChip, AnexoImagem, EQUIPE_ANEXO_ACCEPT, EquipeConversaAvatar } from './EquipeShared';
import { formatTime } from '../mensagensLogic';
import type { useEquipeChatData } from '../hooks/useEquipeChatData';
import { useEquipeThread } from '../hooks/useEquipeThread';

type EquipeData = ReturnType<typeof useEquipeChatData>;

interface EquipeThreadProps {
  conversa: EquipeConversa;
  mensagens: EquipeData['mensagens'];
  send: EquipeData['send'];
  markSeen: EquipeData['markSeen'];
  /** Shows a back arrow in the header (the page passes it only where there's no sidebar). */
  onBack?: () => void;
  /** Opens the conversation-details sheet. */
  onOpenDetalhes?: () => void;
}

const BUBBLE_AVATAR = { width: 28, height: 28, fontSize: '0.65rem', flexShrink: 0 } as const;

/** Desktop thread of a team conversation. Phones use EquipeThreadPhone. */
export function EquipeThread({
  conversa,
  mensagens,
  send,
  markSeen,
  onBack,
  onOpenDetalhes,
}: EquipeThreadProps) {
  const {
    meuId,
    draft,
    setDraft,
    anexosPendentes,
    removerAnexo,
    uploading,
    fileInputRef,
    scrollRef,
    itens,
    anexar,
    podeEnviar,
    enviar,
    onComposerKeyDown,
  } = useEquipeThread({ conversa, mensagens, send, markSeen });

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
        <EquipeConversaAvatar conversa={conversa} size={40} />
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
                  onClick={() => removerAnexo(a.id)}
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
            accept={EQUIPE_ANEXO_ACCEPT}
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
            onKeyDown={onComposerKeyDown}
            placeholder="Mensagem para a equipe…"
            className="flex-1 resize-none rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={() => void enviar()}
            disabled={!podeEnviar}
            aria-label="Enviar mensagem"
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-[var(--dark)] disabled:opacity-50 bg-[var(--primary-color)]"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
