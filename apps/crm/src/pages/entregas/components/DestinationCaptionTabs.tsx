import type { ReactNode, Ref } from 'react';
import { PLATFORM_DEFS, captionMaxFor, type PlatformId } from '@mesaas/platforms';
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
  activeTab: PlatformId | null;
  onActiveTabChange: (p: PlatformId) => void;
  locked: boolean;
  instagramCaption: ReactNode;
  tiktokSettings: ReactNode;
  tiktokFieldRef: Ref<DestinationCaptionFieldHandle>;
  geralFieldRef: Ref<DestinationCaptionFieldHandle>;
  onSaveCaption: (platform: 'tiktok' | 'geral', text: string) => Promise<void>;
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
  activeTab,
  onActiveTabChange,
  locked,
  instagramCaption,
  tiktokSettings,
  tiktokFieldRef,
  geralFieldRef,
  onSaveCaption,
}: DestinationCaptionTabsProps) {
  if (loading) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        Carregando destinos…
      </p>
    );
  }
  if (targets.length === 0) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        Este post não tem destinos. Ative um em Destinos.
      </p>
    );
  }
  const value =
    activeTab && targets.some((t) => t.platform === activeTab) ? activeTab : targets[0].platform;
  const geral = targets.find((t) => t.platform === 'geral');

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onActiveTabChange(v as PlatformId)}
      className="mt-3 rounded-lg border-2 p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <TabsList className="h-auto flex-wrap justify-start gap-1">
        {targets.map((t) => {
          const Icon = PLATFORM_ICONS[t.platform];
          return (
            <TabsTrigger key={t.platform} value={t.platform} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {PLATFORM_DEFS[t.platform].label}
              <DestinationStatusPill
                platform={t.platform}
                state={resolveDestinationState(post, t)}
              />
            </TabsTrigger>
          );
        })}
      </TabsList>

      {targets.map((t) => {
        const hint = nativeFormatHint(t.platform, post.tipo);
        return (
          <TabsContent
            key={t.platform}
            value={t.platform}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            {hint && (
              <p className="mb-2 text-xs" style={{ color: 'var(--text-light)' }}>
                Formato: {hint}
              </p>
            )}
            {t.platform === 'instagram' && instagramCaption}
            {t.platform === 'tiktok' && (
              <div className="flex flex-col gap-3">
                <DestinationCaptionField
                  key={post.id}
                  ref={tiktokFieldRef}
                  id={`tt-dest-caption-${post.id}`}
                  label="Legenda do TikTok"
                  // O publicador do TikTok posta tiktok_caption ?? ig_caption: a aba mostra
                  // exatamente isso. Editar aqui grava tiktok_caption e separa as duas.
                  value={post.tiktok_caption ?? post.ig_caption ?? ''}
                  max={captionMaxFor('tiktok', post.tipo)}
                  placeholder="Texto exato que será publicado no TikTok."
                  hint={
                    post.tiktok_caption == null && post.ig_caption
                      ? 'Usando a legenda do Instagram até você editar aqui.'
                      : undefined
                  }
                  disabled={locked}
                  lockedMessage="Cancelar agendamento para editar"
                  onSave={(text) => onSaveCaption('tiktok', text)}
                />
                {tiktokSettings}
              </div>
            )}
            {t.platform === 'geral' && geral && (
              <DestinationCaptionField
                key={post.id}
                ref={geralFieldRef}
                id={`geral-caption-${post.id}`}
                label="Legenda (Geral)"
                value={geral.caption ?? ''}
                max={null}
                placeholder="Legenda que acompanha o conteúdo para baixar."
                hint="Geral não é publicado automaticamente: o conteúdo fica disponível para baixar."
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
