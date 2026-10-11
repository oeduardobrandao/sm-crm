import { Calendar, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { BottomActionBar } from '@/components/mobile';
import { formatPostWeekday } from '@/utils/postDate';
import type { WorkflowPost } from '../../../../store';
import { getPostPublishState } from '../../postLabels';
import type { ScheduleActions } from '../ScheduleButton';
import { TikTokPostingDeclaration } from '../TikTokPostingDeclaration';
import type { PhoneEditorChrome } from './types';

/** "ter, 13 out · 18:00": weekday, day and the exact time. */
export function formatPhoneDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${formatPostWeekday(iso)} · ${time}`;
}

interface PhoneBottomBarProps {
  post: WorkflowPost;
  actions: ScheduleActions;
  sendToClient?: PhoneEditorChrome['sendToClient'];
}

/**
 * The editor's primary action follows the post status (C0bAgendado / C0bFalha / the
 * Agendar mockups). Every button calls the same command the desktop ScheduleButton or
 * drawer header calls; nothing is re-implemented here. Renders nothing when the status
 * has no action, so the screen keeps its full height.
 */
export function PhoneBottomBar({ post, actions: s, sendToClient }: PhoneBottomBarProps) {
  if (post.status === 'aprovado_interno' && sendToClient && sendToClient.count > 0) {
    return (
      <BottomActionBar className="phone-editor-bar">
        <button
          type="button"
          className="phone-editor-bar__primary"
          disabled={sendToClient.sending}
          onClick={sendToClient.onSend}
        >
          <Send aria-hidden="true" />
          {sendToClient.count > 1
            ? `Enviar ${sendToClient.count} posts ao cliente`
            : 'Enviar ao cliente'}
        </button>
      </BottomActionBar>
    );
  }

  if (s.visibility !== 'shown') return null;

  if (post.status === 'agendado') {
    const publishing = getPostPublishState(post) === 'publicando';
    return (
      <BottomActionBar className="phone-editor-bar">
        <div className="phone-editor-bar__column">
          {s.warningMessage && (
            <p className="phone-editor-bar__warning" role="alert">
              {s.warningMessage} A publicação agendada pode falhar.
            </p>
          )}
          <div className="phone-editor-bar__row phone-editor-bar__row--stacked">
            <span className="phone-editor-bar__state">
              {publishing ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" /> Publicando…
                </>
              ) : (
                <>
                  <Calendar aria-hidden="true" />
                  {post.scheduled_at
                    ? `Agendado para ${formatPhoneDateTime(post.scheduled_at)}`
                    : 'Agendado'}
                </>
              )}
            </span>
            <button
              type="button"
              className="phone-editor-bar__destructive"
              onClick={s.handleCancel}
              disabled={s.loading}
            >
              <X aria-hidden="true" /> Cancelar agendamento
            </button>
          </div>
        </div>
      </BottomActionBar>
    );
  }

  if (post.status === 'falha_publicacao') {
    // platform 'both' with one side failed: retry sends only that side (handleRetry).
    const onlyOne =
      s.platform === 'both' && s.igFailed !== s.ttFailed
        ? `Só o ${s.igFailed ? 'Instagram' : 'TikTok'} será reenviado`
        : null;
    return (
      <BottomActionBar className="phone-editor-bar">
        <div className="phone-editor-bar__column">
          {s.warningMessage && (
            <p className="phone-editor-bar__warning" role="alert">
              {s.warningMessage}
            </p>
          )}
          {onlyOne && <p className="phone-editor-bar__note">{onlyOne}</p>}
          <button
            type="button"
            className="phone-editor-bar__primary phone-editor-bar__primary--danger"
            onClick={s.handleRetry}
            disabled={s.loading || s.retryBlocked}
          >
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      </BottomActionBar>
    );
  }

  if (post.status === 'aprovado_cliente') {
    const missing =
      !s.accountWarning && !s.canPublishNow && s.missingItems.length > 0
        ? `Falta: ${s.missingItems.join(', ')}`
        : null;
    return (
      <BottomActionBar className="phone-editor-bar">
        <div className="phone-editor-bar__column">
          {s.warningMessage && (
            <p className="phone-editor-bar__warning" role="alert">
              {s.warningMessage}
            </p>
          )}
          {missing && <p className="phone-editor-bar__missing">{missing}</p>}
          {s.mediaViolations.length > 0 && (
            <p className="phone-editor-bar__warning">
              {s.mediaViolations.length === 1
                ? s.mediaViolations[0]
                : `${s.mediaViolations.length} problemas na mídia. Veja em Publicar.`}
            </p>
          )}
          {/* TikTok audit A3: the declaration sits directly above every control that
              sends a TikTok post, the bar's buttons included. */}
          {s.targetsTikTok && s.tiktokReady && (
            <TikTokPostingDeclaration
              brandedContent={s.tiktokBranded}
              className="phone-editor-bar__declaration"
            />
          )}
          <div className="phone-editor-bar__row">
            <button
              type="button"
              className="phone-editor-bar__secondary"
              onClick={() => s.setConfirmOpen(true)}
              disabled={!s.canPublishNow || s.loading}
              title={s.tiktokBlockedTitle}
            >
              <Send aria-hidden="true" /> Publicar agora
            </button>
            <button
              type="button"
              className="phone-editor-bar__primary"
              onClick={s.handleSchedule}
              disabled={!s.canSchedule || s.loading}
              title={s.tiktokBlockedTitle}
            >
              <Calendar aria-hidden="true" /> Agendar publicação
            </button>
          </div>
        </div>
      </BottomActionBar>
    );
  }

  return null;
}
