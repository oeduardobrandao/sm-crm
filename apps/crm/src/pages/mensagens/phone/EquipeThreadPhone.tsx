import type { ReactNode } from 'react';
import { Paperclip, Send, Users, X } from 'lucide-react';
import { MentionEditor } from '@/components/mentions/MentionEditor';
import { MentionText } from '@/components/mentions/MentionText';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import type { EquipeConversa } from '@/store';
import { ThreadSkeleton } from '../components/ConversationThread';
import {
  AnexoChip,
  AnexoImagem,
  EQUIPE_ANEXO_ACCEPT,
  EquipeConversaAvatar,
  EquipePessoaAvatar,
} from '../components/EquipeShared';
import { horaMensagem } from '../equipeChatLogic';
import type { useEquipeChatData } from '../hooks/useEquipeChatData';
import { useEquipeThread } from '../hooks/useEquipeThread';
import { ThreadPhoneShell } from './ThreadPhoneShell';
import './mensagensPhone.css';

type EquipeData = ReturnType<typeof useEquipeChatData>;

interface Props {
  conversa: EquipeConversa;
  mensagens: EquipeData['mensagens'];
  send: EquipeData['send'];
  markSeen: EquipeData['markSeen'];
  onOpenDetalhes: () => void;
  /** Rendered inside the screen (the details sheet). */
  children?: ReactNode;
}

/**
 * One team conversation below 768px: the same pushed screen as a client thread
 * (ConversationThreadPhone), with the details button in the nav bar, the author's name
 * on colleagues' bubbles, attachments, and a composer that attaches files and
 * autocompletes @-mentions.
 */
export function EquipeThreadPhone({
  conversa,
  mensagens,
  send,
  markSeen,
  onOpenDetalhes,
  children,
}: Props) {
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
    rows,
    anexar,
    podeEnviar,
    enviar,
    onComposerKeyDown,
  } = useEquipeThread({ conversa, mensagens, send, markSeen });

  return (
    <ThreadPhoneShell
      title={
        <>
          <EquipeConversaAvatar conversa={conversa} size={32} />
          <span className="phone-msg-thread__name">{conversa.display_nome}</span>
        </>
      }
      trailing={
        <PhoneIconButton label="Ver detalhes da conversa" onClick={onOpenDetalhes}>
          <Users aria-hidden="true" />
        </PhoneIconButton>
      }
    >
      <div ref={scrollRef} data-testid="thread-scroll" className="phone-msg-thread__scroll">
        {mensagens.hasNextPage && (
          <button
            type="button"
            onClick={() => mensagens.fetchNextPage()}
            disabled={mensagens.isFetchingNextPage}
            className="phone-msg-thread__older"
          >
            {mensagens.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {mensagens.isError && (
          <div className="phone-msg-thread__state">
            <p>Não foi possível carregar as mensagens.</p>
            <button
              type="button"
              className="phone-msg-thread__retry"
              onClick={() => mensagens.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!mensagens.isError && mensagens.isLoading && <ThreadSkeleton />}
        {!mensagens.isError && !mensagens.isLoading && itens.length === 0 && (
          <p className="phone-msg-thread__state">Nenhuma mensagem nesta conversa ainda.</p>
        )}
        {rows.map((row) => {
          if (row.kind === 'dia') {
            return (
              <div key={row.key} role="separator" className="phone-msg-day">
                {row.label}
              </div>
            );
          }
          const { mensagem: m, inicio, fim } = row;
          const minha = m.author_user_id === meuId;
          return (
            <div
              key={m.id}
              data-testid={`equipe-msg-${m.id}`}
              className={`phone-msg-bubble-row${minha ? ' phone-msg-bubble-row--mine' : ''}${inicio ? '' : ' phone-msg-bubble-row--cont'}`}
            >
              {!fim ? (
                <span style={{ width: 28, height: 28, flexShrink: 0 }} aria-hidden="true" />
              ) : (
                <EquipePessoaAvatar
                  nome={m.author_name}
                  fotoUrl={m.author_avatar_url}
                  seed={m.author_user_id}
                  size={28}
                  fontSize="0.65rem"
                />
              )}
              <div className="phone-msg-bubble-col">
                <div className="phone-msg-bubble">
                  {!minha && inicio && (
                    <div className="phone-msg-bubble__author">{m.author_name}</div>
                  )}
                  {m.content && (
                    <p className="phone-msg-bubble__text">
                      <MentionText text={m.content} />
                    </p>
                  )}
                  {m.anexos.map((a) =>
                    a.mime_type.startsWith('image/') ? (
                      <AnexoImagem key={a.id} anexo={a} className="phone-msg-bubble__img" />
                    ) : (
                      <AnexoChip
                        key={a.id}
                        anexo={a}
                        className="phone-msg-chip phone-msg-bubble__file"
                        style={{}}
                      />
                    ),
                  )}
                </div>
                {fim && <span className="phone-msg-time">{horaMensagem(m.created_at)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="phone-kit phone-msg-composer">
        {anexosPendentes.length > 0 && (
          <div className="phone-msg-composer__anexos">
            {anexosPendentes.map((a) => (
              <span key={a.id} className="phone-msg-composer__anexo">
                <Paperclip aria-hidden="true" />
                <span className="phone-msg-composer__anexo-name">{a.file_name}</span>
                <button
                  type="button"
                  className="phone-msg-composer__cancel"
                  onClick={() => removerAnexo(a.id)}
                  aria-label={`Remover ${a.file_name}`}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="phone-msg-composer__row">
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
            type="button"
            className="phone-msg-composer__attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Anexar arquivo"
          >
            <Paperclip aria-hidden="true" />
          </button>
          <MentionEditor
            value={draft}
            onValueChange={setDraft}
            onKeyDown={onComposerKeyDown}
            placeholder="Mensagem para a equipe…"
            rootClassName="phone-msg-composer__field"
            className="phone-msg-composer__input phone-msg-composer__input--area"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!podeEnviar}
            aria-label="Enviar mensagem"
            className="phone-msg-composer__send"
          >
            <Send aria-hidden="true" />
          </button>
        </div>
      </div>
      {children}
    </ThreadPhoneShell>
  );
}
