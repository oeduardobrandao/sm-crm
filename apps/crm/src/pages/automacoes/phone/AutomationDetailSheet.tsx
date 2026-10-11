import { useTranslation } from 'react-i18next';
import { ExternalLink, Instagram, Pencil, Trash2, Users } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { ListSkeleton } from '@/components/ui/skeletons';
import { sanitizeUrl } from '@/utils/security';
import type { InstagramAutomationSend, InstagramCommentAutomation } from '../../../store';
import { SEND_STATUS_TONE, shortDate, targetSummary, type TargetSummary } from './phoneFormat';
import { Pill } from './Pill';
import './automacoesPhone.css';

export interface AutomationDetailSheetProps {
  /** The automation on show; null keeps the sheet closed. */
  automation: InstagramCommentAutomation | null;
  onClose: () => void;
  clienteNome: string;
  /** `can('automacoes', 'editar') === true`: gates the re-target action, as on desktop. */
  canEdit: boolean;
  /** Contacts this automation reached (desktop's "Ver contatos (N)"); 0 hides the row. */
  reachedCount: number;
  sends: InstagramAutomationSend[] | undefined;
  sendsLoading: boolean;
  sendsError: boolean;
  formatDateTime: (iso: string) => string;
  onToggle: (automation: InstagramCommentAutomation, ativo: boolean) => void;
  onEdit: (automation: InstagramCommentAutomation) => void;
  onDelete: (automation: InstagramCommentAutomation) => void;
  onRetarget: (automation: InstagramCommentAutomation) => void;
  onViewContacts: (automation: InstagramCommentAutomation) => void;
}

/**
 * Phone face of the desktop row's expand area plus its kebab: target (with the
 * re-target action), keywords, DM buttons and card, counters, "Ver contatos", the
 * sends log, Editar and Excluir. Every action calls the page's own handler; the ones
 * that open another overlay go through `closeThen` so the sheet's history entry is
 * gone before the next layer opens.
 */
export function AutomationDetailSheet(props: AutomationDetailSheetProps) {
  const { automation, onClose } = props;
  return (
    <BottomSheet
      open={automation != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={automation?.name ?? ''}
      detents={['medium', 'large']}
      className="phone-auto-sheet"
    >
      {automation && <DetailBody {...props} automation={automation} />}
    </BottomSheet>
  );
}

function DetailBody({
  automation: a,
  clienteNome,
  canEdit,
  reachedCount,
  sends,
  sendsLoading,
  sendsError,
  formatDateTime,
  onToggle,
  onEdit,
  onDelete,
  onRetarget,
  onViewContacts,
}: AutomationDetailSheetProps & { automation: InstagramCommentAutomation }) {
  const { t } = useTranslation('automations');
  const { closeThen } = useSheetActions();
  const target = targetSummary(a, t);
  const buttons = a.dm_buttons ?? [];
  const permalink = a.ig_media_id && a.media_permalink ? sanitizeUrl(a.media_permalink) : null;

  const targetFooter = target.unlinked
    ? t('unlinkedTargetHint')
    : target.deleted
      ? t('reactivateNeedsTarget')
      : undefined;

  return (
    <div className="phone-auto-detail">
      <GroupedList aria-label={a.name}>
        <Cell
          label={t('table.active')}
          switch={{ checked: a.ativo, onCheckedChange: (ativo) => onToggle(a, ativo) }}
        />
        <Cell label={t('table.client')} value={clienteNome} />
      </GroupedList>

      <GroupedList header={t('table.target')} footer={targetFooter}>
        <li className="phone-cell phone-auto-li">
          {permalink ? (
            <a
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="phone-cell__main phone-auto-detail__target"
            >
              <TargetLine text={target.text} badge={target.badge} />
              <ExternalLink className="phone-cell__chevron" aria-hidden="true" />
            </a>
          ) : (
            <div className="phone-cell__main phone-auto-detail__target">
              <TargetLine text={target.text} badge={target.badge} />
            </div>
          )}
        </li>
        {target.unlinked && canEdit && (
          <Cell
            label={t('unlinkedTargetAction')}
            icon={<Instagram aria-hidden="true" />}
            chevron
            onClick={() => closeThen(() => onRetarget(a))}
          />
        )}
      </GroupedList>

      {a.keywords.length > 0 && (
        <GroupedList header={t('table.keywords')}>
          <li className="phone-cell phone-auto-li">
            <div className="phone-auto-detail__pills">
              {a.keywords.map((k) => (
                <Pill key={k} mono>
                  {k}
                </Pill>
              ))}
            </div>
          </li>
        </GroupedList>
      )}

      <GroupedList header={t('phone.dmHeader')}>
        <li className="phone-cell phone-auto-li">
          <p className="phone-auto-detail__message">{a.dm_message}</p>
        </li>
        {buttons.map((b, i) => (
          <Cell key={`${b.title}-${i}`} label={b.title} subtitle={b.url} />
        ))}
        {a.dm_media && (
          <li className="phone-cell phone-auto-li">
            <div className="phone-auto-detail__pills">
              <Pill tone="info">{t('table.cardBadge')}</Pill>
            </div>
          </li>
        )}
      </GroupedList>

      <GroupedList header={t('phone.statsHeader')}>
        <Cell label={t('table.dmsSent')} value={String(a.dms_sent_count)} />
        <Cell
          label={t('table.lastTriggered')}
          value={a.last_triggered_at ? shortDate(a.last_triggered_at) : t('neverTriggered')}
        />
        {reachedCount > 0 && (
          <Cell
            label={t('contacts.viewContacts', { count: reachedCount })}
            icon={<Users aria-hidden="true" />}
            chevron
            onClick={() => closeThen(() => onViewContacts(a))}
          />
        )}
      </GroupedList>

      <GroupedList header={t('phone.sendsHeader')}>
        {sendsLoading ? (
          <li className="phone-cell phone-auto-li">
            <ListSkeleton rows={2} style={{ padding: '0.5rem 1rem' }} />
          </li>
        ) : sendsError || !sends || sends.length === 0 ? (
          <li className="phone-cell phone-auto-li">
            <p className="phone-auto-detail__note">
              {sendsError ? t('sendsLoadError') : t('sendsEmpty')}
            </p>
          </li>
        ) : (
          sends.map((s) => (
            <li key={s.id} className="phone-cell phone-auto-li">
              <div className="phone-auto-send">
                <div className="phone-auto-send__top">
                  <strong className="phone-auto-send__user">
                    @{s.commenter_username ?? t('unknownCommenter')}
                  </strong>
                  <Pill tone={SEND_STATUS_TONE[s.status]}>{t(`sendStatus.${s.status}`)}</Pill>
                  {s.dm_kind === 'buttons_fallback_text' ||
                  s.dm_kind === 'card_fallback_buttons' ||
                  s.dm_kind === 'card_fallback_text' ? (
                    <Pill>{t(`sendStatus.${s.dm_kind}`)}</Pill>
                  ) : null}
                </div>
                <span className="phone-auto-send__meta">
                  {formatDateTime(s.comment_created_at)}
                </span>
                {s.comment_text && (
                  <span className="phone-auto-send__comment">“{s.comment_text}”</span>
                )}
              </div>
            </li>
          ))
        )}
      </GroupedList>

      <GroupedList aria-label={t('phone.actionsHeader')}>
        <Cell
          label={t('edit')}
          icon={<Pencil aria-hidden="true" />}
          onClick={() => closeThen(() => onEdit(a))}
        />
        <Cell
          label={t('delete')}
          icon={<Trash2 aria-hidden="true" />}
          destructive
          onClick={() => closeThen(() => onDelete(a))}
        />
      </GroupedList>
    </div>
  );
}

function TargetLine({ text, badge }: { text: string | null; badge: TargetSummary['badge'] }) {
  return (
    <span className="phone-auto-detail__target-text">
      {text && <span className="phone-auto-detail__target-caption">{text}</span>}
      {badge && <Pill tone={badge.tone}>{badge.label}</Pill>}
    </span>
  );
}
