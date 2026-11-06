import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlatformId } from '@mesaas/platforms';
import type { CaptionGroup } from '../../lib/postView';

interface PlatformCaptionsProps {
  groups: CaptionGroup[];
  /** Classes for the caption text itself (media and text posts style it differently). */
  textClassName: string;
}

const PLATFORM_LABEL_KEYS: Record<PlatformId, [string, string]> = {
  instagram: ['platform.instagram', 'Instagram'],
  tiktok: ['platform.tiktok', 'TikTok'],
  geral: ['platform.other', 'Geral'],
};

/** Joins destination names the way the copy reads them: "Instagram, TikTok e Geral". */
export function usePlatformNames(): (platforms: PlatformId[]) => string {
  const { t: tCard, i18n } = useTranslation('hubPostCard');
  return (platforms) =>
    new Intl.ListFormat(i18n.language || 'pt-BR', {
      style: 'long',
      type: 'conjunction',
    }).format(platforms.map((p) => tCard(...PLATFORM_LABEL_KEYS[p])));
}

interface CaptionTabsProps {
  /** One tab per caption group; the label is the group's destination names. */
  groups: { platforms: PlatformId[] }[];
  active: number;
  onChange: (index: number) => void;
  /** Tabs to mark with the "changed" dot (edit panel). */
  dirty?: boolean[];
  /** The id of the tabpanel the tabs control. */
  panelId: string;
}

/**
 * The segmented switcher shared by the reading view and the edit panel: `role="tablist"`,
 * left/right arrows move between tabs. Controlled: the caller owns the active index.
 */
export function CaptionTabs({ groups, active, onChange, dirty, panelId }: CaptionTabsProps) {
  const { t } = useTranslation('hubPosts');
  const names = usePlatformNames();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length;
    onChange(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t('captions.tablistLabel', 'Legenda de cada plataforma')}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] p-[3px] hub-bg-soft"
    >
      {groups.map((group, i) => (
        <button
          key={group.platforms.join('-')}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${panelId}-tab-${i}`}
          aria-selected={i === active}
          aria-controls={`${panelId}-panel`}
          tabIndex={i === active ? 0 : -1}
          onClick={() => onChange(i)}
          onKeyDown={onKeyDown}
          className={`inline-flex items-center gap-1.5 h-8 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
            i === active ? 'hub-bg-card hub-txt shadow-sm' : 'hub-tx2'
          }`}
        >
          {names(group.platforms)}
          {dirty?.[i] && (
            <span
              role="img"
              aria-label={t('captions.changedTab', 'alterada')}
              className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400"
            />
          )}
        </button>
      ))}
    </div>
  );
}

/** The tabpanel paired with `CaptionTabs`. */
export function CaptionTabPanel({
  panelId,
  active,
  children,
}: {
  panelId: string;
  active: number;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-tab-${active}`}>
      {children}
    </div>
  );
}

/**
 * Each destination's caption (spec 2026-10-30-hub-captions-per-platform-design.md). Destinations
 * with the same caption share one block; when they differ, a segmented switcher picks one.
 */
export function PlatformCaptions({ groups, textClassName }: PlatformCaptionsProps) {
  const { t } = useTranslation('hubPosts');
  const names = usePlatformNames();
  const [active, setActive] = useState(0);
  const panelId = useId();

  const renderGroup = (group: CaptionGroup) => (
    <div className="space-y-2">
      {group.text ? (
        <p className={`${textClassName} whitespace-pre-wrap`}>{group.text}</p>
      ) : (
        <p className="text-[13px] hub-tx3">{t('captions.empty', 'Sem legenda')}</p>
      )}
      {group.platforms.includes('geral') && (
        <p className="text-[12px] hub-tx3">
          {t(
            'captions.geralNote',
            'Esta legenda não é publicada automaticamente. A equipe usa ela para publicar por fora.',
          )}
        </p>
      )}
    </div>
  );

  if (groups.length === 1) {
    const [group] = groups;
    return (
      <div className="space-y-2">
        {group.platforms.length > 1 && (
          <p className="text-[12px] font-semibold hub-tx2">
            {t('captions.sameFor', 'Mesma legenda para {{names}}', {
              names: names(group.platforms),
            })}
          </p>
        )}
        {renderGroup(group)}
      </div>
    );
  }

  const current = Math.min(active, groups.length - 1);
  return (
    <div className="space-y-3">
      <CaptionTabs groups={groups} active={current} onChange={setActive} panelId={panelId} />
      <CaptionTabPanel panelId={panelId} active={current}>
        {renderGroup(groups[current])}
      </CaptionTabPanel>
    </div>
  );
}
