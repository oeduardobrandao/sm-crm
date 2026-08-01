import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, FilePen, FileText, Send } from 'lucide-react';
import type { Cliente, MensagemFeedItem } from '@/store';
import { avatarColorClass } from '@/lib/avatarColor';

interface Props {
  item: MensagemFeedItem;
  cliente?: Pick<Cliente, 'nome' | 'sigla' | 'cor'>;
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

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** 28px author avatar: member photo (or seeded initials) for agency items,
 * the cliente's sigla + cor for client items — same tokens as the rest of the CRM. */
function AuthorAvatar({ item, cliente }: { item: MensagemFeedItem; cliente?: Props['cliente'] }) {
  const size = { width: 28, height: 28, fontSize: '0.65rem', flexShrink: 0 } as const;
  if (item.is_workspace_user) {
    if (item.author_avatar_url) {
      return (
        <img
          src={item.author_avatar_url}
          alt=""
          className="avatar"
          style={{ ...size, objectFit: 'cover' }}
        />
      );
    }
    const name = item.author_name ?? 'Equipe';
    return (
      <div
        className={`avatar ${avatarColorClass(item.author_user_id ?? name)}`}
        style={size}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </div>
    );
  }
  return (
    <div
      className="avatar"
      style={{
        ...size,
        background: cliente?.cor || undefined,
        color: cliente?.cor ? '#fff' : undefined,
      }}
      aria-hidden="true"
    >
      {cliente?.sigla || initialsOf(item.cliente_nome)}
    </div>
  );
}

export function MensagemFeedCard({ item, cliente, onReply }: Props) {
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
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <AuthorAvatar item={item} cliente={cliente} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{author}</span>
            {isAgency && (
              <span className="text-[var(--text-light)] truncate">· {item.cliente_nome}</span>
            )}
          </div>
          {headline && (
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)]">
              {item.source === 'edit_suggestion' ? (
                <FilePen size={12} className="shrink-0" />
              ) : item.action === 'aprovado' ? (
                <CheckCircle2 size={12} className="shrink-0" />
              ) : null}
              {headline}
            </div>
          )}
        </div>
        <span className="ml-auto shrink-0 text-xs text-[var(--text-light)]">
          {new Date(item.created_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {item.content && <p className="text-sm whitespace-pre-wrap">{item.content}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {item.workflow_id != null && (
          <Link
            to={`/entregas?drawer=${item.workflow_id}`}
            className="flex w-fit items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 font-semibold transition-colors hover:bg-[var(--surface-hover)]"
            style={{ background: 'var(--bg-color)' }}
          >
            <FileText size={14} className="shrink-0 text-[var(--text-muted)]" />
            <span>{item.post_titulo ?? 'Ver post'}</span>
            <ArrowUpRight size={12} className="shrink-0 text-[var(--text-light)]" />
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
            className="rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{
              background: 'var(--text-main)',
              color: 'var(--card-bg)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
