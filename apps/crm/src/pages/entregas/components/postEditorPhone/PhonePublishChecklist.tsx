import { AlertCircle, Check } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile';
import type { WorkflowPost } from '../../../../store';
import type { PostMedia } from '../../../../store/posts';
import type { ScheduleActions } from '../ScheduleButton';
import { formatPhoneDateTime } from './PhoneBottomBar';

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check aria-label="Pronto" className="phone-editor-check phone-editor-check--ok" />
  ) : (
    <span className="phone-editor-missing">Falta</span>
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
  if (s.visibility === 'missing-ig-account-note') {
    return (
      <GroupedList header="Antes de agendar" headerAs="h3">
        <Cell
          label="Conta do Instagram"
          subtitle="Conecte a conta do Instagram do cliente para agendar ou publicar este post."
          accessory={<Mark ok={false} />}
        />
      </GroupedList>
    );
  }
  if (s.visibility !== 'shown' || post.status !== 'aprovado_cliente') return null;

  const captionLabel =
    s.targetsInstagram && s.targetsTikTok
      ? 'Legenda'
      : s.targetsTikTok
        ? 'Legenda do TikTok'
        : 'Legenda do Instagram';
  const mediaCount = media?.length ?? 0;

  return (
    <GroupedList
      header="Antes de agendar"
      headerAs="h3"
      footer={
        !s.accountWarning && !s.canPublishNow && s.missingItems.length > 0
          ? `Falta: ${s.missingItems.join(', ')}`
          : undefined
      }
    >
      <Cell
        label="Mídia"
        value={
          mediaCount === 0
            ? 'Nenhum arquivo'
            : mediaCount === 1
              ? '1 arquivo'
              : `${mediaCount} arquivos`
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
          label="Configurações do TikTok"
          subtitle={!s.tiktokReady ? s.tiktokBlockedTitle : undefined}
          accessory={<Mark ok={s.tiktokReady} />}
        />
      )}
      <Cell
        label="Data"
        value={post.scheduled_at ? formatPhoneDateTime(post.scheduled_at) : undefined}
        accessory={<Mark ok={!!post.scheduled_at} />}
      />
      {s.warningMessage && (
        <Cell
          label="Conta"
          subtitle={s.warningMessage}
          icon={<AlertCircle />}
          accessory={<Mark ok={false} />}
        />
      )}
    </GroupedList>
  );
}
