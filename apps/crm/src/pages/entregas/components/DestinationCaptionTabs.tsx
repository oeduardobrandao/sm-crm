import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORM_DEFS, captionMaxFor, type PlatformId } from '@mesaas/platforms';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PLATFORM_ICONS } from '@/components/platformIcons';
import type { WorkflowPost } from '@/store/posts';
import type { PostTargetRow } from '@/store/postTargets';
import { nativeFormatHint, resolveDestinationState } from '../postDestinations';
import { DestinationStatusPill } from './DestinationStatusPill';
import {
  DestinationCaptionField,
  type DestinationCaptionFieldHandle,
} from './DestinationCaptionField';

interface DestinationCaptionTabsProps {
  post: WorkflowPost;
  targets: PostTargetRow[];
  loading: boolean;
  /** Falha ao carregar os destinos (só vale sem destinos em cache). */
  error?: boolean;
  onRetry?: () => void;
  activeTab: PlatformId | null;
  onActiveTabChange: (p: PlatformId) => void;
  locked: boolean;
  instagramCaption: ReactNode;
  tiktokSettings: ReactNode;
  tiktokFieldRef: Ref<DestinationCaptionFieldHandle>;
  geralFieldRef: Ref<DestinationCaptionFieldHandle>;
  onSaveCaption: (platform: 'tiktok' | 'geral', text: string) => Promise<void>;
  /** Shown above the TikTok / Geral field while a pending client suggestion changed it. */
  tiktokNote?: ReactNode;
  geralNote?: ReactNode;
}

/**
 * Uma aba de legenda por destino (spec UX 2, P2). Legendas sempre separadas:
 * Instagram em ig_caption (campo com comentários, montado pelo PostEditorBody),
 * TikTok em tiktok_caption, Geral em post_targets.caption.
 *
 * forceMount + hidden: trocar de aba nunca desmonta um rascunho (useCaptionDraft
 * registra trabalho não salvo e tem debounce em voo). O auto-grow do campo do
 * Instagram mede scrollHeight; escondido mede 0 e reajusta pelo ResizeObserver ao
 * aparecer (conferir no browser, ver Task 12).
 */
export function DestinationCaptionTabs({
  post,
  targets,
  loading,
  error,
  onRetry,
  activeTab,
  onActiveTabChange,
  locked,
  instagramCaption,
  tiktokSettings,
  tiktokFieldRef,
  geralFieldRef,
  onSaveCaption,
  tiktokNote,
  geralNote,
}: DestinationCaptionTabsProps) {
  const { t } = useTranslation('postPanels');
  if (loading) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        {t('destinationTabs.loading')}
      </p>
    );
  }
  if (targets.length === 0 && error) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
          {t('destinationTabs.loadError')}
        </p>
        {onRetry && (
          <Button type="button" variant="link" size="sm" className="mb-0" onClick={onRetry}>
            {t('destinationTabs.retry')}
          </Button>
        )}
      </div>
    );
  }
  if (targets.length === 0) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        {t('destinationTabs.empty')}
      </p>
    );
  }
  const value =
    activeTab && targets.some((tg) => tg.platform === activeTab) ? activeTab : targets[0].platform;
  const geral = targets.find((tg) => tg.platform === 'geral');

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onActiveTabChange(v as PlatformId)}
      className="mt-3 rounded-lg border-2 p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <TabsList className="h-auto flex-wrap justify-start gap-1">
        {targets.map((tg) => {
          const Icon = PLATFORM_ICONS[tg.platform];
          return (
            <TabsTrigger key={tg.platform} value={tg.platform} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {PLATFORM_DEFS[tg.platform].label}
              <DestinationStatusPill
                platform={tg.platform}
                state={resolveDestinationState(post, tg)}
                showIcon={false}
              />
            </TabsTrigger>
          );
        })}
      </TabsList>

      {targets.map((tg) => {
        const hint = nativeFormatHint(tg.platform, post.tipo);
        return (
          <TabsContent
            key={tg.platform}
            value={tg.platform}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            {hint && (
              <p className="mb-2 text-xs" style={{ color: 'var(--text-light)' }}>
                {t('destinationTabs.format', { hint })}
              </p>
            )}
            {tg.platform === 'instagram' && instagramCaption}
            {tg.platform === 'tiktok' && (
              <div className="flex flex-col gap-3">
                {tiktokNote && <div>{tiktokNote}</div>}
                <DestinationCaptionField
                  key={post.id}
                  ref={tiktokFieldRef}
                  id={`tt-dest-caption-${post.id}`}
                  label={t('destinationTabs.tiktokLabel')}
                  // O publicador do TikTok posta tiktok_caption ?? ig_caption: a aba mostra
                  // exatamente isso. Editar aqui grava tiktok_caption e separa as duas.
                  value={post.tiktok_caption ?? post.ig_caption ?? ''}
                  max={captionMaxFor('tiktok', post.tipo)}
                  placeholder={t('destinationTabs.tiktokPlaceholder')}
                  hint={
                    post.tiktok_caption == null && post.ig_caption
                      ? t('destinationTabs.tiktokUsingIg')
                      : undefined
                  }
                  disabled={locked}
                  lockedMessage={t('destinationTabs.cancelToEdit')}
                  onSave={(text) => onSaveCaption('tiktok', text)}
                />
                {tiktokSettings}
              </div>
            )}
            {tg.platform === 'geral' && geralNote}
            {tg.platform === 'geral' && geral && (
              <DestinationCaptionField
                key={post.id}
                ref={geralFieldRef}
                id={`geral-caption-${post.id}`}
                label={t('destinationTabs.geralLabel')}
                value={geral.caption ?? ''}
                max={null}
                placeholder={t('destinationTabs.geralPlaceholder')}
                hint={t('destinationTabs.geralHint')}
                showCopy
                onSave={(text) => onSaveCaption('geral', text)}
              />
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
