import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PostMedia, WorkflowPost } from '../../../store';
import { targetsInstagram } from '../platformTargets';

interface TrialReelPanelProps {
  post: WorkflowPost;
  media: PostMedia[];
  /** isScheduleLocked do drawer: o cron cria o container até 1h antes do
   * horário, então a estratégia trava junto com data e legenda. */
  disabled: boolean;
  /** Quantos colaboradores o post tem: Reel de teste e colaboradores se excluem. */
  collaboratorsCount: number;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  className?: string;
}

/**
 * Reel de teste (Instagram Trial Reel): visível só para não-seguidores até a
 * "graduação". Renderiza apenas em posts reels mirando Instagram; o trigger
 * workflow_posts_z5_clear_ig_trial garante a invariante no banco.
 */
export function TrialReelPanel({
  post,
  media,
  disabled,
  collaboratorsCount,
  onFieldChange,
  className,
}: TrialReelPanelProps) {
  const { t } = useTranslation('posts');
  if (post.tipo !== 'reels' || !targetsInstagram(post.platform)) return null;

  const strategy = post.ig_trial_strategy ?? null;
  const enabled = strategy !== null;
  const mediaQualifies = media.length === 1 && media[0]?.kind === 'video';
  // Com colaboradores o switch só trava se o teste estiver desligado: ligado (o CHECK do
  // banco não deixa, mas por garantia) ele segue desligável.
  const blockedByCollaborators = !enabled && collaboratorsCount > 0;
  // Um motivo só, nesta ordem: agendamento vence colaboradores.
  const reasonLine = disabled
    ? t('trialReel.lockedBySchedule')
    : blockedByCollaborators
      ? t('trialReel.blockedByCollaborators')
      : null;

  return (
    <div className={cn('drawer-post-field drawer-post-field--trial', className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="trial-reel-switch">{t('trialReel.label')}</label>
        <Switch
          id="trial-reel-switch"
          checked={enabled}
          disabled={disabled || blockedByCollaborators}
          onCheckedChange={(on) => onFieldChange('ig_trial_strategy', on ? 'auto' : null)}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-light)' }}>
        {t('trialReel.description')}
      </p>
      {reasonLine && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-light)' }}>
          {reasonLine}
        </p>
      )}
      {enabled && (
        <>
          <ToggleGroup
            type="single"
            value={strategy ?? undefined}
            disabled={disabled}
            className="mt-2 flex-col items-stretch gap-1"
            onValueChange={(v) => {
              if (v === 'auto' || v === 'manual') onFieldChange('ig_trial_strategy', v);
            }}
          >
            <ToggleGroupItem value="auto" className="justify-start text-left">
              {t('trialReel.strategyAuto')}
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className="justify-start text-left">
              {t('trialReel.strategyManual')}
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-light)' }}>
            {t('trialReel.requirements')}
          </p>
          {!mediaQualifies && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger-text)' }}>
              {t('trialReel.needsOneVideo')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
