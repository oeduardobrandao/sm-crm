import { AlertCircle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cell, GroupedList } from '@/components/mobile';
import type { WorkflowPost } from '../../../../store';
import type { PostMedia } from '../../../../store/posts';
import type { ScheduleActions } from '../ScheduleButton';
import { formatPhoneDateTime } from './PhoneBottomBar';

function Mark({ ok }: { ok: boolean }) {
  const { t } = useTranslation('postEditor');
  return ok ? (
    <Check
      aria-label={t('phonePublishChecklist.ready')}
      className="phone-editor-check phone-editor-check--ok"
    />
  ) : (
    <span className="phone-editor-missing">{t('phonePublishChecklist.missing')}</span>
  );
}

/**
 * "Antes de agendar" (EditorPublicar mockup). Every row reads the exact value
 * ScheduleButton gates on (`useScheduleActions`): date, required caption, TikTok
 * readiness, media preflight and account health. Nothing is re-derived here, so the
 * list can never say "pronto" while the button stays disabled.
 */
export function PhonePublishChecklist({
  post,
  media,
  actions: s,
}: {
  post: WorkflowPost;
  media: PostMedia[] | undefined;
  actions: ScheduleActions;
}) {
  const { t } = useTranslation('postEditor');
  if (s.visibility === 'missing-ig-account-note') {
    return (
      <GroupedList header={t('phonePublishChecklist.header')} headerAs="h3">
        <Cell
          label={t('phonePublishChecklist.igAccount')}
          subtitle={t('phonePublishChecklist.connectIg')}
          accessory={<Mark ok={false} />}
        />
      </GroupedList>
    );
  }
  if (s.visibility !== 'shown' || post.status !== 'aprovado_cliente') return null;

  const captionLabel =
    s.targetsInstagram && s.targetsTikTok
      ? t('shared.caption')
      : s.targetsTikTok
        ? t('phonePublishChecklist.tiktokCaption')
        : t('shared.igCaption');
  const mediaCount = media?.length ?? 0;

  return (
    <GroupedList
      header={t('phonePublishChecklist.header')}
      headerAs="h3"
      footer={
        !s.accountWarning && !s.canPublishNow && s.missingItems.length > 0
          ? t('shared.missingItems', { items: s.missingItems.join(', ') })
          : undefined
      }
    >
      <Cell
        label={t('phonePublishChecklist.media')}
        value={
          mediaCount === 0
            ? t('phonePublishChecklist.noFiles')
            : t('phonePublishChecklist.files', { count: mediaCount })
        }
        subtitle={s.mediaViolations.length > 0 ? s.mediaViolations.join(' ') : undefined}
        // While media is still loading neither mark would be true yet.
        accessory={
          mediaCount === 0 && !s.missingMedia ? undefined : (
            <Mark ok={!s.missingMedia && s.mediaViolations.length === 0} />
          )
        }
      />
      {!s.isStoryPost && (
        <Cell label={captionLabel} accessory={<Mark ok={s.hasRequiredCaption} />} />
      )}
      {s.targetsTikTok && (
        <Cell
          label={t('phonePublishChecklist.tiktokSettings')}
          subtitle={!s.tiktokReady ? s.tiktokBlockedTitle : undefined}
          accessory={<Mark ok={s.tiktokReady} />}
        />
      )}
      <Cell
        label={t('phonePublishChecklist.date')}
        value={post.scheduled_at ? formatPhoneDateTime(post.scheduled_at) : undefined}
        accessory={<Mark ok={!!post.scheduled_at} />}
      />
      {s.warningMessage && (
        <Cell
          label={t('phonePublishChecklist.account')}
          subtitle={s.warningMessage}
          icon={<AlertCircle />}
          accessory={<Mark ok={false} />}
        />
      )}
    </GroupedList>
  );
}
