import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { computeWordDiff } from '@mesaas/text-diff';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { fetchPostHistory, submitApproval } from '../api';
import {
  buildHistoryEntries,
  computePostKpis,
  formatDuration,
  selectComments,
  type HistoryEntry,
} from '../lib/postHistory';
import { getClientStatusLabel, VISIBLE_STATUSES } from '../lib/postView';
import { formatDate } from './PostCard';
import type { HubPost, PostApproval, PostHistoryResponse } from '../types';

interface PostHistoryPanelProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  onCommentSent?: () => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: PostHistoryResponse };

export function TextDiff({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => computeWordDiff(before, after), [before, after]);
  return (
    <p className="text-[12px] leading-relaxed whitespace-pre-wrap hub-tx2">
      {segments.map((segment, i) =>
        segment.type === 'delete' ? (
          <del key={i} className="bg-rose-50 text-rose-700 no-underline line-through">
            {segment.text}
          </del>
        ) : segment.type === 'insert' ? (
          <ins key={i} className="bg-emerald-50 text-emerald-800 no-underline">
            {segment.text}
          </ins>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

export function PostHistoryPanel({ post, token, approvals, onCommentSent }: PostHistoryPanelProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'history' | 'comments'>('history');
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set());
  useUnsavedWork(text.trim() !== '' || sending);

  const visible = VISIBLE_STATUSES.has(post.status);

  useEffect(() => {
    if (!open || !visible) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    fetchPostHistory(token, post.id)
      .then((data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, visible, token, post.id, reloadKey]);

  if (!visible) return null;

  const mine = approvals.filter((a) => a.post_id === post.id);
  const decisionCount = mine.filter((a) => a.action !== 'mensagem').length;
  // Same rule as hub-post-history/selectComments: team notes are never counted.
  const commentCount = mine.filter((a) => a.action === 'mensagem' && !a.is_workspace_user).length;

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(false);
    try {
      await submitApproval(token, post.id, 'mensagem', body);
      setText('');
      setReloadKey((k) => k + 1);
      onCommentSent?.();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  function toggleDiff(key: string) {
    setOpenDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function actorLabel(source: 'client' | 'team' | 'system' | boolean): string {
    if (source === 'client' || source === false) return t('history.actor.you', 'Você');
    if (source === 'system') return t('history.actor.system', 'Sistema');
    return t('history.actor.team', 'Equipe');
  }

  function renderEntry(entry: HistoryEntry) {
    const when = formatDate(entry.at, dateLang);
    if (entry.kind === 'send') {
      return (
        <li key={entry.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold hub-txt">
              {t('history.sentVersion', 'v{{version}}: enviado para aprovação', {
                version: entry.version,
              })}
            </span>
            <span className="text-[11px] hub-tx3">{when}</span>
          </div>
          <span className="text-[11px] hub-tx3">{actorLabel('team')}</span>
          {entry.diff && (
            <div>
              <button
                type="button"
                onClick={() => toggleDiff(entry.key)}
                className="text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: 'var(--hub-acc)' }}
              >
                {openDiffs.has(entry.key)
                  ? t('history.hideDiff', 'Ocultar alterações')
                  : t('history.showDiff', 'Ver alterações na legenda')}
              </button>
              {openDiffs.has(entry.key) && (
                <TextDiff before={entry.diff.before} after={entry.diff.after} />
              )}
            </div>
          )}
        </li>
      );
    }
    if (entry.kind === 'approval') {
      return (
        <li key={entry.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-[12px] font-semibold ${entry.action === 'aprovado' ? 'text-emerald-700' : 'text-rose-700'}`}
            >
              {entry.action === 'aprovado'
                ? t('history.approved', 'Aprovado')
                : t('history.correctionRequested', 'Correção solicitada')}
            </span>
            <span className="text-[11px] hub-tx3">{when}</span>
          </div>
          <span className="text-[11px] hub-tx3">{actorLabel(entry.byTeam)}</span>
          {entry.motivo && (
            <p className="text-[11px] hub-tx2">
              {t('history.motivoLabel', 'Motivo')}:{' '}
              {t(`correctionReason.${entry.motivo}`, entry.motivo)}
            </p>
          )}
          {entry.comentario && (
            <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{entry.comentario}</p>
          )}
        </li>
      );
    }
    return (
      <li key={entry.key} className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold hub-txt">
            {getClientStatusLabel(t, entry.to_status)}
          </span>
          <span className="text-[11px] hub-tx3">{when}</span>
        </div>
        <span className="text-[11px] hub-tx3">{actorLabel(entry.source)}</span>
      </li>
    );
  }

  const data = load.status === 'ready' ? load.data : null;
  const entries = data ? buildHistoryEntries(data) : [];
  const comments = data ? selectComments(data) : [];
  const kpis = data ? computePostKpis(data) : null;

  return (
    <div className="border-t hub-border px-4 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left"
      >
        <span className="text-[12px] font-semibold hub-txt">
          {t('history.toggle', 'Histórico e comentários')}
        </span>
        <span className="flex items-center gap-2 text-[11px] hub-tx3">
          {t('history.summary', '{{decisions}} decisões · {{comments}} comentários', {
            decisions: decisionCount,
            comments: commentCount,
          })}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="pb-2 space-y-3">
          <div role="tablist" className="flex gap-1 border-b hub-border">
            {(['history', 'comments'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className="px-3 py-1.5 text-[12px] font-semibold border-b-2 -mb-px"
                style={
                  tab === key
                    ? { borderColor: 'var(--hub-acc)', color: 'var(--hub-txt)' }
                    : { borderColor: 'transparent', color: 'var(--hub-tx3)' }
                }
              >
                {key === 'history'
                  ? t('history.tabHistory', 'Histórico')
                  : t('history.tabComments', 'Comentários')}
              </button>
            ))}
          </div>

          {load.status === 'loading' && (
            <p className="text-[12px] hub-tx3">{t('history.loading', 'Carregando histórico...')}</p>
          )}
          {load.status === 'error' && (
            <p className="text-[12px] text-rose-700">
              {t('history.loadError', 'Não foi possível carregar o histórico.')}
            </p>
          )}

          {data && tab === 'history' && (
            <div className="space-y-3">
              {kpis && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] hub-tx2">
                  <span>
                    {t('history.kpi.rounds', '{{count}} rodada(s) de correção', {
                      count: kpis.rounds,
                    })}
                  </span>
                  <span>
                    {kpis.avgResponseMs === null
                      ? t('history.kpi.noData', 'Tempo médio de resposta: sem dados ainda')
                      : t('history.kpi.avgResponse', 'Tempo médio de resposta: {{value}}', {
                          value: formatDuration(kpis.avgResponseMs),
                        })}
                  </span>
                </div>
              )}
              {entries.length === 0 ? (
                <p className="text-[12px] hub-tx3">
                  {t('history.empty', 'Nenhum evento registrado ainda.')}
                </p>
              ) : (
                <ol className="space-y-3">{entries.map(renderEntry)}</ol>
              )}
            </div>
          )}

          {data && tab === 'comments' && (
            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-[12px] hub-tx3">
                  {t('history.emptyComments', 'Nenhum comentário ainda. Escreva o primeiro.')}
                </p>
              ) : (
                <ol className="space-y-3">
                  {comments.map((c) => (
                    <li key={c.id} className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold hub-tx3">
                          {actorLabel(c.is_workspace_user)}
                        </span>
                        <span className="text-[11px] hub-tx3">
                          {formatDate(c.created_at, dateLang)}
                        </span>
                      </div>
                      <p className="text-[12px] hub-tx2 whitespace-pre-wrap">{c.comentario}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="space-y-1.5">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4000}
                  placeholder={t(
                    'history.composerPlaceholder',
                    'Escreva um comentário sobre este post',
                  )}
                  className="hub-focus-accent w-full rounded border hub-border px-3 py-2 text-[12px] resize-none min-h-[60px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none"
                />
                {sendError && (
                  <p className="text-[11px] text-rose-700">
                    {t('history.sendError', 'Não foi possível enviar o comentário.')}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || text.trim() === ''}
                    className="hub-btn-primary rounded px-4 py-2 min-h-[36px] text-[12px] font-semibold disabled:opacity-50"
                  >
                    {sending ? t('history.sending', 'Enviando...') : t('history.send', 'Enviar')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
