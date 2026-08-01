import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FilePen, MessageCircle, Send } from 'lucide-react';
import type { MensagemFeedItem } from '@/store';

interface Props {
  item: MensagemFeedItem;
  onReply: (postId: number, workflowId: number, content: string) => Promise<unknown>;
}

const ACTION_LABEL: Record<string, string> = {
  aprovado: 'Aprovou o post',
  correcao: 'Pediu correção',
  mensagem: 'Mensagem',
  pending: 'Sugestão de edição enviada',
  accepted: 'Sugestão de edição aceita',
  rejected: 'Sugestão de edição rejeitada',
};

export function MensagemFeedCard({ item, onReply }: Props) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const isAgency = item.is_workspace_user;
  const author = isAgency ? (item.author_name ?? 'Equipe') : item.cliente_nome;
  const headline =
    item.source === 'edit_suggestion'
      ? (ACTION_LABEL[item.action ?? 'pending'] ?? 'Sugestão de edição')
      : item.source === 'post_feedback' && item.action !== 'mensagem'
        ? (ACTION_LABEL[item.action ?? ''] ?? item.action)
        : null;

  async function submitReply() {
    if (sending || !draft.trim() || item.post_id == null || item.workflow_id == null) return;
    setSending(true);
    try {
      await onReply(item.post_id, item.workflow_id, draft.trim());
      setDraft('');
      setReplying(false);
    } catch {
      // onReply already surfaces a toast; keep the draft so the user doesn't lose their text.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        {item.source === 'edit_suggestion' ? (
          <FilePen size={15} className="shrink-0" />
        ) : item.action === 'aprovado' ? (
          <CheckCircle2 size={15} className="shrink-0" />
        ) : (
          <MessageCircle size={15} className="shrink-0" />
        )}
        <span className="font-semibold">{author}</span>
        <span className="text-[var(--text-light)]">· {item.cliente_nome}</span>
        <span className="ml-auto text-xs text-[var(--text-light)]">
          {new Date(item.created_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {headline && <div className="text-xs font-semibold text-[var(--text-muted)]">{headline}</div>}
      {item.content && <p className="text-sm whitespace-pre-wrap">{item.content}</p>}
      <div className="flex items-center gap-3 text-xs">
        {item.workflow_id != null && (
          <Link
            to={`/entregas?drawer=${item.workflow_id}`}
            className="font-semibold underline text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            {item.post_titulo ?? 'Ver post'}
          </Link>
        )}
        {item.post_id != null && item.source !== 'edit_suggestion' && (
          <button
            onClick={() => setReplying((v) => !v)}
            className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            Responder
          </button>
        )}
      </div>
      {replying && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitReply();
            }}
            placeholder="Responder ao cliente…"
            className="flex-1 rounded-md border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm outline-none"
            autoFocus
          />
          <button
            onClick={submitReply}
            disabled={sending || !draft.trim()}
            aria-label="Enviar resposta"
            className="rounded-md px-3 py-2 text-sm font-semibold bg-[var(--primary-color)] disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
