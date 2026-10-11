import { CheckCircle2, FilePen, Reply, Send, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { useMensagensData } from '../hooks/useMensagensData';
import { useConversationThread } from '../hooks/useConversationThread';
import { AutorAvatar, ClienteAvatar } from '../components/Avatars';
import { ThreadSkeleton } from '../components/ConversationThread';
import {
  eventLabel,
  feedItemKey,
  formatTime,
  isEventRow,
  TIPO_FILTERS,
  type MensagensTipoFilter,
} from '../mensagensLogic';
import { PostChipPhone } from './PostChipPhone';
import { ThreadPhoneShell } from './ThreadPhoneShell';
import './mensagensPhone.css';

type MensagensData = ReturnType<typeof useMensagensData>;

interface Props {
  conversa: MensagemConversa;
  feed: MensagensData['feed'];
  sendGeneral: MensagensData['sendGeneral'];
  replyToPost: MensagensData['replyToPost'];
  clientesById: Map<number, Cliente>;
}

/**
 * One conversation below 768px (FMensagensThread): a pushed screen with the nav bar,
 * the four type filters as a segmented control, the messages, and the composer pinned
 * at the bottom (the tab bar is hidden on this route, see ThreadPhoneShell). Reply
 * about a post lives on the post chip's long-press menu.
 */
export function ConversationThreadPhone({
  conversa,
  feed,
  sendGeneral,
  replyToPost,
  clientesById,
}: Props) {
  const { tipo, setTipo, draft, setDraft, replyTo, setReplyTo, itens, scrollRef, sending, enviar } =
    useConversationThread({ conversa, feed, sendGeneral, replyToPost });
  const cliente = clientesById.get(conversa.cliente_id);

  return (
    <ThreadPhoneShell
      title={
        <>
          <ClienteAvatar
            nome={conversa.cliente_nome}
            fotoUrl={conversa.cliente_foto_url}
            cliente={cliente}
          />
          <span className="phone-msg-thread__name">{conversa.cliente_nome}</span>
        </>
      }
    >
      <div className="phone-msg-thread__filters">
        <SegmentedControl<MensagensTipoFilter>
          aria-label="Tipo de mensagem"
          options={TIPO_FILTERS.map((f) => ({ value: f.id, label: f.label }))}
          value={tipo}
          onChange={setTipo}
        />
      </div>

      <div ref={scrollRef} data-testid="thread-scroll" className="phone-msg-thread__scroll">
        {feed.hasNextPage && (
          <button
            type="button"
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="phone-msg-thread__older"
          >
            {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {feed.isError && (
          <div className="phone-msg-thread__state">
            <p>Não foi possível carregar as mensagens.</p>
            <button
              type="button"
              className="phone-msg-thread__retry"
              onClick={() => feed.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!feed.isError && feed.isLoading && <ThreadSkeleton />}
        {!feed.isError && !feed.isLoading && itens.length === 0 && (
          <p className="phone-msg-thread__state">Nenhuma mensagem nesta conversa ainda.</p>
        )}
        {itens.map((m) => {
          if (isEventRow(m)) {
            return (
              <div key={feedItemKey(m)} className="phone-msg-event">
                <span className="phone-msg-event__line">
                  {m.source === 'edit_suggestion' ? (
                    <FilePen aria-hidden="true" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" />
                  )}
                  <span>{eventLabel(m)}</span>
                  {m.post_id != null && (
                    <PostChipPhone
                      postId={m.post_id}
                      workflowId={m.workflow_id}
                      titulo={m.post_titulo}
                    />
                  )}
                </span>
                <span className="phone-msg-time">{formatTime(m.created_at)}</span>
              </div>
            );
          }
          const daEquipe = m.is_workspace_user;
          return (
            <div
              key={feedItemKey(m)}
              className={`phone-msg-bubble-row${daEquipe ? ' phone-msg-bubble-row--mine' : ''}`}
            >
              <AutorAvatar
                item={m}
                cliente={clientesById.get(m.cliente_id)}
                clienteFotoUrl={conversa.cliente_foto_url}
              />
              <div className="phone-msg-bubble-col">
                <div className="phone-msg-bubble">
                  {daEquipe && (
                    <div className="phone-msg-bubble__author">{m.author_name ?? 'Equipe'}</div>
                  )}
                  {m.action === 'correcao' && (
                    <div className="phone-msg-bubble__action">Pediu correção</div>
                  )}
                  {m.content && <p className="phone-msg-bubble__text">{m.content}</p>}
                  {m.post_id != null && (
                    <div className="phone-msg-bubble__chip">
                      <PostChipPhone
                        postId={m.post_id}
                        workflowId={m.workflow_id}
                        titulo={m.post_titulo}
                        onReply={() =>
                          setReplyTo({
                            postId: m.post_id!,
                            workflowId: m.workflow_id,
                            titulo: m.post_titulo ?? 'Post',
                          })
                        }
                      />
                    </div>
                  )}
                </div>
                <span className="phone-msg-time">{formatTime(m.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="phone-kit phone-msg-composer">
        {replyTo && (
          <div className="phone-msg-composer__reply">
            <Reply aria-hidden="true" />
            <span className="phone-msg-composer__reply-text">
              Respondendo sobre: <strong>{replyTo.titulo}</strong>
            </span>
            <button
              type="button"
              className="phone-msg-composer__cancel"
              onClick={() => setReplyTo(null)}
              aria-label="Cancelar resposta"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="phone-msg-composer__row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enviar();
            }}
            enterKeyHint="send"
            placeholder={replyTo ? 'Responder sobre o post…' : 'Enviar mensagem…'}
            aria-label={replyTo ? 'Responder sobre o post' : 'Mensagem'}
            className="phone-msg-composer__input"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={sending || !draft.trim()}
            aria-label="Enviar mensagem"
            className="phone-msg-composer__send"
          >
            <Send aria-hidden="true" />
          </button>
        </div>
      </div>
    </ThreadPhoneShell>
  );
}
