import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PostMedia, WorkflowPost } from '../../../store';

interface TrialReelPanelProps {
  post: WorkflowPost;
  media: PostMedia[];
  /** isScheduleLocked do drawer: o cron cria o container até 1h antes do
   * horário, então a estratégia trava junto com data e legenda. */
  disabled: boolean;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
}

/**
 * Reel de teste (Instagram Trial Reel): visível só para não-seguidores até a
 * "graduação". Renderiza apenas em posts reels mirando Instagram; o trigger
 * workflow_posts_z5_clear_ig_trial garante a invariante no banco.
 */
export function TrialReelPanel({ post, media, disabled, onFieldChange }: TrialReelPanelProps) {
  if (post.tipo !== 'reels' || (post.platform ?? 'instagram') === 'tiktok') return null;

  const strategy = post.ig_trial_strategy ?? null;
  const enabled = strategy !== null;
  const mediaQualifies = media.length === 1 && media[0]?.kind === 'video';

  return (
    <div className="drawer-post-field drawer-post-field--trial">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="trial-reel-switch">Reel de teste</label>
        <Switch
          id="trial-reel-switch"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(on) => onFieldChange('ig_trial_strategy', on ? 'auto' : null)}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--text-light)' }}>
        Publica como teste, visível só para quem não segue a conta.
      </p>
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
              Compartilhar com todos automaticamente se performar bem
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className="justify-start text-left">
              Eu decido manualmente no app do Instagram
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-light)' }}>
            Exige conta profissional pública com pelo menos 1.000 seguidores. Não funciona com
            colaboradores no post.
          </p>
          {!mediaQualifies && (
            <p className="mt-1 text-xs" style={{ color: 'var(--danger-text)' }}>
              Reel de teste exige exatamente um vídeo no post.
            </p>
          )}
          {disabled && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-light)' }}>
              Cancelar agendamento para editar
            </p>
          )}
        </>
      )}
    </div>
  );
}
