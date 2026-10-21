# Tutoriais em vídeo no Guia de primeiros passos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Central de Ajuda tutorial videos inside the CRM onboarding guide (a card per matching guide page, a featured card on the guide home, an "Indo Além" block on the last page), saving watch progress to the same place the Central de Ajuda reads.

**Architecture:** Extract the Central de Ajuda player's progress-saving logic into `usePlaybackProgress`, reuse it in a new `GuideVideoCard`. A `GuideVideoSlot` (rendered only inside the open dialog) resolves a slug from `guideContent.tsx` to a published video via the existing `useKbVideoSeries`/`useVideoProgress` hooks, and renders nothing when the video is missing.

**Tech Stack:** React 19, TanStack Query, Vitest + Testing Library (jsdom), `@mesaas/ui/VideoPlayer` (hls.js), lucide-react.

Spec: `docs/superpowers/specs/2026-10-01-onboarding-tutorial-videos-design.md`. Mockups: https://claude.ai/artifact/NqqwPM9ECtvbZvjhCtg5GF

## Global Constraints

- All UI copy is pt-BR, sentence case, **no em-dashes** in user-facing strings.
- Icons: `lucide-react` only. No new dependencies.
- Guide files use **relative imports** (`../../pages/...`), not `@/`. Keep that.
- `useKbVideoSeries`/`useVideoProgress` must only be called from components rendered inside `DialogContent`, never from `GuideDialog`'s body or `GuideProvider`.
- A missing/unpublished/renamed video renders **nothing** (no placeholder, no error).
- No schema, edge function, or backend change.
- Run commands from the worktree root: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/onboarding-videos-popup-5291ab`.

---

### Task 1: Extract `usePlaybackProgress` from `VideoStage`

**Files:**
- Create: `apps/crm/src/pages/ajuda/videos/usePlaybackProgress.ts`
- Modify: `apps/crm/src/pages/ajuda/videos/VideoStage.tsx` (lines 1–107: imports, refs and handlers)
- Test: `apps/crm/src/pages/ajuda/videos/__tests__/usePlaybackProgress.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const SAVE_INTERVAL_MS = 10_000;
  export type SaveProgress = (videoId: number, position: number, completed: boolean) => void;
  export interface PlaybackHandlers {
    onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void;
    onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => void;
    onPause: (e: SyntheticEvent<HTMLVideoElement>) => void;
    onEnded: (e: SyntheticEvent<HTMLVideoElement>) => void;
  }
  export function usePlaybackProgress(
    videoId: number,
    progress: ProgressMap,
    onSave: SaveProgress,
    onEnded?: () => void,
  ): { handlers: PlaybackHandlers; positionRef: MutableRefObject<number>; resumeRef: MutableRefObject<number | null> };
  ```

- [ ] **Step 1: Write the failing test**

`apps/crm/src/pages/ajuda/videos/__tests__/usePlaybackProgress.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import type { SyntheticEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toProgressMap } from '../playlist';
import { SAVE_INTERVAL_MS, usePlaybackProgress } from '../usePlaybackProgress';

function ev(currentTime: number, duration = 100) {
  return { currentTarget: { currentTime, duration } } as unknown as SyntheticEvent<HTMLVideoElement>;
}

const NONE = toProgressMap([]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('usePlaybackProgress', () => {
  it('saves at most once per interval while playing', () => {
    const save = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(5));
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    result.current.handlers.onTimeUpdate(ev(15));
    expect(save).toHaveBeenCalledWith(7, 15, false);
  });

  it('marks completion once at 90% of the duration', () => {
    const save = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(90, 100));
    result.current.handlers.onTimeUpdate(ev(91, 100));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(7, 90, true);
  });

  it('resumes from the saved position only on the first loadedmetadata', () => {
    const progress = toProgressMap([{ video_id: 7, position_seconds: 42, completed_at: null }]);
    const { result } = renderHook(() => usePlaybackProgress(7, progress, vi.fn()));
    const first = ev(0);
    result.current.handlers.onLoadedMetadata(first);
    expect((first.currentTarget as HTMLVideoElement).currentTime).toBe(42);
    const second = ev(0);
    result.current.handlers.onLoadedMetadata(second);
    expect((second.currentTarget as HTMLVideoElement).currentTime).toBe(0);
  });

  it('flushes the position on pagehide and on unmount', () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(12));
    window.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenLastCalledWith(7, 12, false);
    save.mockClear();
    unmount();
    expect(save).toHaveBeenCalledWith(7, 12, false);
  });

  it('ended saves completion and calls the callback', () => {
    const save = vi.fn();
    const onEnded = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save, onEnded));
    result.current.handlers.onEnded(ev(100, 100));
    expect(save).toHaveBeenCalledWith(7, 100, true);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos/__tests__/usePlaybackProgress.test.tsx`
Expected: FAIL, cannot resolve `../usePlaybackProgress`.

- [ ] **Step 3: Write the hook**

`apps/crm/src/pages/ajuda/videos/usePlaybackProgress.ts`:

```ts
import { useCallback, useEffect, useRef, type MutableRefObject, type SyntheticEvent } from 'react';
import { isCompleted, reachedCompletion, resumePosition, type ProgressMap } from './playlist';

/** How often playback position is persisted while the video plays. */
export const SAVE_INTERVAL_MS = 10_000;

export type SaveProgress = (videoId: number, position: number, completed: boolean) => void;

type VideoEvent = SyntheticEvent<HTMLVideoElement>;

export interface PlaybackHandlers {
  onLoadedMetadata: (e: VideoEvent) => void;
  onTimeUpdate: (e: VideoEvent) => void;
  onPause: (e: VideoEvent) => void;
  onEnded: (e: VideoEvent) => void;
}

/** Progress persistence for ONE video's player, shared by the Central de Ajuda stage and the
 * onboarding guide card. The caller keys its player by video id, so every ref starts fresh per
 * video. `positionRef`/`resumeRef` are exposed so a retry can resume where playback failed. */
export function usePlaybackProgress(
  videoId: number,
  progress: ProgressMap,
  onSave: SaveProgress,
  onEnded?: () => void,
): {
  handlers: PlaybackHandlers;
  positionRef: MutableRefObject<number>;
  resumeRef: MutableRefObject<number | null>;
} {
  const saveRef = useRef(onSave);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    saveRef.current = onSave;
    endedRef.current = onEnded;
  });
  const positionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const completedRef = useRef(isCompleted(progress, videoId));
  const resumeRef = useRef(resumePosition(progress, videoId));

  useEffect(() => {
    lastSaveAtRef.current = Date.now();
  }, []);

  const flush = useCallback(() => {
    if (positionRef.current > 0) saveRef.current(videoId, positionRef.current, false);
  }, [videoId]);

  // Save on tab close/navigation away and when the player unmounts.
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const handlers: PlaybackHandlers = {
    onLoadedMetadata: (e) => {
      const el = e.currentTarget;
      const resume = resumeRef.current;
      resumeRef.current = null;
      if (resume !== null && (!Number.isFinite(el.duration) || resume < el.duration - 1)) {
        el.currentTime = resume;
      }
    },
    onTimeUpdate: (e) => {
      const el = e.currentTarget;
      positionRef.current = el.currentTime;
      const now = Date.now();
      if (!completedRef.current && reachedCompletion(el.currentTime, el.duration)) {
        completedRef.current = true;
        lastSaveAtRef.current = now;
        saveRef.current(videoId, el.currentTime, true);
        return;
      }
      if (now - lastSaveAtRef.current >= SAVE_INTERVAL_MS) {
        lastSaveAtRef.current = now;
        saveRef.current(videoId, el.currentTime, false);
      }
    },
    onPause: (e) => {
      positionRef.current = e.currentTarget.currentTime;
      if (positionRef.current > 0) {
        lastSaveAtRef.current = Date.now();
        saveRef.current(videoId, positionRef.current, false);
      }
    },
    onEnded: (e) => {
      positionRef.current = e.currentTarget.currentTime;
      completedRef.current = true;
      saveRef.current(videoId, positionRef.current, true);
      endedRef.current?.();
    },
  };

  return { handlers, positionRef, resumeRef };
}
```

- [ ] **Step 4: Run the hook test**

Run: `npx vitest run apps/crm/src/pages/ajuda/videos/__tests__/usePlaybackProgress.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Refactor `VideoStage` onto the hook**

In `apps/crm/src/pages/ajuda/videos/VideoStage.tsx`, replace everything from the first line through the end of `handleEnded` (current lines 1–107) with:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { NextUpOverlay } from './NextUpOverlay';
import { nextInSeries, type ProgressMap } from './playlist';
import { usePlaybackProgress } from './usePlaybackProgress';

interface VideoStageProps {
  video: KbVideo;
  series: KbVideoSeries;
  progress: ProgressMap;
  autoPlay: boolean;
  onSaveProgress: (videoId: number, position: number, completed: boolean) => void;
  onPlayNext: (next: KbVideo) => void;
}

/** Player + metadata for ONE video. The parent keys it by video id, so every ref below starts
 * fresh per video. */
export function VideoStage({
  video,
  series,
  progress,
  autoPlay,
  onSaveProgress,
  onPlayNext,
}: VideoStageProps) {
  const [endState, setEndState] = useState<'playing' | 'next' | 'done'>('playing');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const next = nextInSeries(series, video.id);
  const { handlers, positionRef, resumeRef } = usePlaybackProgress(
    video.id,
    progress,
    onSaveProgress,
    () => setEndState(next ? 'next' : 'done'),
  );
```

Then in the JSX, replace the four handler props on `<VideoPlayer>`:

```tsx
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPause={handlePause}
            onEnded={handleEnded}
```

with:

```tsx
            {...handlers}
```

The retry button's `positionRef`/`resumeRef` lines stay as they are (now the hook's refs).

- [ ] **Step 6: Run the Central de Ajuda suites**

Run: `npx vitest run apps/crm/src/pages/ajuda`
Expected: all pass (VideoPage, VideoPlaylistBlock, useKbVideos, playlist, usePlaybackProgress).

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/ajuda/videos/usePlaybackProgress.ts apps/crm/src/pages/ajuda/videos/VideoStage.tsx apps/crm/src/pages/ajuda/videos/__tests__/usePlaybackProgress.test.tsx
git commit -m "refactor(ajuda): extrai usePlaybackProgress do VideoStage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Map guide pages to video slugs + analytics event

**Files:**
- Modify: `apps/crm/src/components/guide/guideContent.tsx` (`GuidePage` interface; pages `t1p2`, `t1p3`, `t1p4`, `t2p3`, `t3p2`, `t3p3`, `t3p5`; new constants)
- Modify: `apps/crm/src/lib/analytics.ts` (union, after `'guide_completed'`)
- Test: `apps/crm/src/components/guide/__tests__/guideContent.test.ts`

**Interfaces:**
- Produces: `GuidePage.videoSlug?: string`; `export const GUIDE_HOME_VIDEO = 'primeiro-acesso'`; `export const GUIDE_MORE_SERIES = 'indo-alem'`; `AnalyticsEvent` includes `'guide_video_played'`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('guideContent', ...)` block of `guideContent.test.ts`, and add `GUIDE_HOME_VIDEO` to the import list:

```ts
  it('mapeia as páginas aos vídeos da série Primeiros Passos, sem repetir', () => {
    const mapped = Object.fromEntries(
      allPages(GUIDE_TRAILS)
        .filter((p) => p.videoSlug)
        .map((p) => [p.id, p.videoSlug]),
    );
    expect(mapped).toEqual({
      t1p2: 'cadastrar-cliente',
      t1p3: 'conectar-instagram',
      t1p4: 'portal-do-cliente',
      t2p3: 'cadastrar-equipe',
      t3p2: 'criar-fluxo',
      t3p3: 'criar-post',
      t3p5: 'agendar-post',
    });
    const all = [GUIDE_HOME_VIDEO, ...Object.values(mapped)];
    expect(new Set(all).size).toBe(all.length);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideContent.test.ts`
Expected: FAIL (`GUIDE_HOME_VIDEO` undefined / mapping `{}`).

- [ ] **Step 3: Implement**

In `guideContent.tsx`, add to `interface GuidePage` after `body?: ReactNode;`:

```ts
  /** Slug de um vídeo da Central de Ajuda mostrado nesta página. Sem vídeo publicado com esse
   * slug, a página fica sem card. */
  videoSlug?: string;
```

After the `GuideTrail` interface, add:

```ts
/** Vídeo em destaque na tela inicial do guia. */
export const GUIDE_HOME_VIDEO = 'primeiro-acesso';
/** Série sugerida na página de fechamento. */
export const GUIDE_MORE_SERIES = 'indo-alem';
```

Add one `videoSlug` line right after each page's `title:` line:

| page `id` | line to add |
|---|---|
| `t1p2` | `videoSlug: 'cadastrar-cliente',` |
| `t1p3` | `videoSlug: 'conectar-instagram',` |
| `t1p4` | `videoSlug: 'portal-do-cliente',` |
| `t2p3` | `videoSlug: 'cadastrar-equipe',` |
| `t3p2` | `videoSlug: 'criar-fluxo',` |
| `t3p3` | `videoSlug: 'criar-post',` |
| `t3p5` | `videoSlug: 'agendar-post',` |

In `apps/crm/src/lib/analytics.ts`, after `  | 'guide_completed'` add:

```ts
  | 'guide_video_played'
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideContent.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide/guideContent.tsx apps/crm/src/components/guide/__tests__/guideContent.test.ts apps/crm/src/lib/analytics.ts
git commit -m "feat(guia): mapeia páginas do guia aos tutoriais em vídeo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GuideVideoCard`

**Files:**
- Create: `apps/crm/src/components/guide/GuideVideoCard.tsx`
- Test: `apps/crm/src/components/guide/__tests__/GuideVideoCard.test.tsx`

**Interfaces:**
- Consumes: `usePlaybackProgress`, `SaveProgress` (Task 1); `'guide_video_played'` (Task 2); `formatDuration`, `isCompleted`, `ProgressMap` from `pages/ajuda/videos/playlist`; `KbVideo` from `store/kbVideos`.
- Produces:
  ```ts
  export function videoLengthLabel(seconds: number | null | undefined): string;
  export interface GuideVideoCardProps {
    video: KbVideo; progress: ProgressMap; onSave: SaveProgress;
    pageId: string; variant: 'featured' | 'inline';
    onOpenInHelpCenter: (slug: string) => void;
  }
  export function GuideVideoCard(props: GuideVideoCardProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

`apps/crm/src/components/guide/__tests__/GuideVideoCard.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureEvent } from '../../../lib/analytics';
import { toProgressMap } from '../../../pages/ajuda/videos/playlist';
import type { KbVideo } from '../../../store/kbVideos';
import { GuideVideoCard, videoLengthLabel } from '../GuideVideoCard';

vi.mock('../../../lib/analytics', () => ({ captureEvent: vi.fn() }));

const VIDEO: KbVideo = {
  id: 4,
  series_id: 's1',
  title: 'Instagram',
  slug: 'conectar-instagram',
  description: null,
  display_order: 4,
  duration_seconds: 86,
  hls_url: 'https://h/4.m3u8',
  thumbnail_url: 'https://h/4.jpg',
  article: null,
};

beforeEach(() => {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
    t: string,
  ) => CanPlayTypeResult;
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  vi.mocked(captureEvent).mockClear();
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
});

function renderCard(over: Partial<Parameters<typeof GuideVideoCard>[0]> = {}) {
  const props = {
    video: VIDEO,
    progress: toProgressMap([]),
    onSave: vi.fn(),
    pageId: 't1p3',
    variant: 'inline' as const,
    onOpenInHelpCenter: vi.fn(),
    ...over,
  };
  return { props, ...render(<GuideVideoCard {...props} />) };
}

describe('videoLengthLabel', () => {
  it('arredonda para minutos com piso de 1', () => {
    expect(videoLengthLabel(46)).toBe('1 minuto');
    expect(videoLengthLabel(86)).toBe('1 minuto');
    expect(videoLengthLabel(120)).toBe('2 minutos');
    expect(videoLengthLabel(null)).toBe('');
    expect(videoLengthLabel(0)).toBe('');
  });
});

describe('GuideVideoCard', () => {
  it('inline: título, duração e chamada', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
    expect(screen.getByText('Prefere ver? Vídeo de 1 minuto')).toBeInTheDocument();
    expect(screen.getByText('1:26')).toBeInTheDocument();
  });

  it('featured: Comece por aqui', () => {
    renderCard({ variant: 'featured', pageId: 'home' });
    expect(screen.getByText('Comece por aqui · vídeo de 1 minuto')).toBeInTheDocument();
  });

  it('sem duração: eyebrow sem tempo e sem selo', () => {
    renderCard({ video: { ...VIDEO, duration_seconds: null } });
    expect(screen.getByText('Prefere ver? Assista ao vídeo')).toBeInTheDocument();
    expect(screen.queryByText('1:26')).not.toBeInTheDocument();
  });

  it('assistido: mostra Assistido e Ver de novo', () => {
    renderCard({
      progress: toProgressMap([
        { video_id: 4, position_seconds: 86, completed_at: '2026-10-01T00:00:00Z' },
      ]),
    });
    expect(screen.getByText('Assistido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver de novo o vídeo Instagram' })).toBeInTheDocument();
  });

  it('clique abre o player, registra o evento e Fechar vídeo volta ao card', () => {
    const { container } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    expect(container.querySelector('video')).not.toBeNull();
    expect(captureEvent).toHaveBeenCalledWith('guide_video_played', {
      page: 't1p3',
      slug: 'conectar-instagram',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar vídeo' }));
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
  });

  it('Ver na Central de Ajuda repassa o slug', () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver na Central de Ajuda' }));
    expect(props.onOpenInHelpCenter).toHaveBeenCalledWith('conectar-instagram');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideVideoCard.test.tsx`
Expected: FAIL, cannot resolve `../GuideVideoCard`.

- [ ] **Step 3: Implement**

`apps/crm/src/components/guide/GuideVideoCard.tsx`:

```tsx
import { useState, type CSSProperties } from 'react';
import { Check, Play, RotateCcw } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { captureEvent } from '../../lib/analytics';
import type { KbVideo } from '../../store/kbVideos';
import { formatDuration, isCompleted, type ProgressMap } from '../../pages/ajuda/videos/playlist';
import {
  usePlaybackProgress,
  type SaveProgress,
} from '../../pages/ajuda/videos/usePlaybackProgress';

/** "1 minuto", "N minutos" (arredondado, mínimo 1); '' sem duração utilizável. */
export function videoLengthLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  return min === 1 ? '1 minuto' : `${min} minutos`;
}

function eyebrow(variant: 'featured' | 'inline', length: string): string {
  if (variant === 'featured') return length ? `Comece por aqui · vídeo de ${length}` : 'Comece por aqui';
  return length ? `Prefere ver? Vídeo de ${length}` : 'Prefere ver? Assista ao vídeo';
}

export interface GuideVideoCardProps {
  video: KbVideo;
  progress: ProgressMap;
  onSave: SaveProgress;
  /** Página do guia, ou 'home' para o card em destaque. Vai para o analytics. */
  pageId: string;
  variant: 'featured' | 'inline';
  onOpenInHelpCenter: (slug: string) => void;
}

const linkButton: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--text-muted)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** Card de um tutorial dentro do guia. Fechado é um único botão; aberto toca o vídeo ali mesmo,
 * salvando o progresso no mesmo lugar que a Central de Ajuda lê. */
export function GuideVideoCard({
  video,
  progress,
  onSave,
  pageId,
  variant,
  onOpenInHelpCenter,
}: GuideVideoCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <ExpandedVideo
        video={video}
        progress={progress}
        onSave={onSave}
        onClose={() => setExpanded(false)}
        onOpenInHelpCenter={onOpenInHelpCenter}
      />
    );
  }

  const featured = variant === 'featured';
  const watched = isCompleted(progress, video.id);
  const duration = formatDuration(video.duration_seconds);
  const thumbWidth = featured ? 160 : 128;

  return (
    <button
      type="button"
      aria-label={`${watched ? 'Ver de novo' : 'Assistir'} o vídeo ${video.title}`}
      onClick={() => {
        captureEvent('guide_video_played', { page: pageId, slug: video.slug });
        setExpanded(true);
      }}
      style={{
        marginTop: featured ? 16 : 14,
        width: '100%',
        minHeight: 44,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: featured ? '10px 14px 10px 10px' : '8px 12px 8px 8px',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        background: featured ? 'var(--surface-1, #f5f6f8)' : 'var(--card-bg, #ffffff)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden="true"
        className="max-[479px]:!w-28"
        style={{
          position: 'relative',
          display: 'block',
          flex: 'none',
          width: thumbWidth,
          aspectRatio: '16 / 9',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#12151a',
        }}
      >
        {video.thumbnail_url && (
          <img
            src={video.thumbnail_url}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: watched ? 0.55 : 1,
            }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 30,
            height: 30,
            marginLeft: -15,
            marginTop: -15,
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: watched ? 'var(--success)' : 'rgba(18,21,26,.78)',
            color: watched ? '#0a0c0f' : '#ffffff',
          }}
        >
          {watched ? <Check className="h-4 w-4" /> : <Play className="h-3 w-3 fill-current" />}
        </span>
        {duration && (
          <span
            style={{
              position: 'absolute',
              right: 5,
              bottom: 5,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(18,21,26,.82)',
              color: '#ffffff',
              fontSize: '0.66rem',
              fontWeight: 600,
            }}
          >
            {duration}
          </span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        {watched ? (
          <span
            style={{
              display: 'inline-flex',
              gap: 5,
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
            }}
          >
            <Check className="h-3 w-3" style={{ color: 'var(--success)' }} />
            Assistido
          </span>
        ) : (
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {eyebrow(variant, videoLengthLabel(video.duration_seconds))}
          </span>
        )}
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontSize: featured ? '0.9rem' : '0.875rem',
            fontWeight: 600,
          }}
        >
          {video.title}
        </span>
        {featured && (
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: '0.78rem',
              lineHeight: 1.45,
              color: 'var(--text-muted)',
            }}
          >
            Um tour rápido antes das trilhas. Os outros vídeos aparecem em cada passo.
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          buttonVariants({ variant: featured && !watched ? 'default' : 'outline', size: 'sm' }),
          'pointer-events-none flex-none max-[479px]:hidden',
        )}
      >
        {watched ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3 w-3 fill-current" />}
        {watched ? 'Ver de novo' : 'Assistir'}
      </span>
    </button>
  );
}

function ExpandedVideo({
  video,
  progress,
  onSave,
  onClose,
  onOpenInHelpCenter,
}: {
  video: KbVideo;
  progress: ProgressMap;
  onSave: SaveProgress;
  onClose: () => void;
  onOpenInHelpCenter: (slug: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { handlers, positionRef, resumeRef } = usePlaybackProgress(video.id, progress, onSave);

  return (
    <div style={{ marginTop: 14 }}>
      <div
        className="relative aspect-video w-full overflow-hidden bg-black"
        style={{ borderRadius: 10 }}
      >
        {failed ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white"
          >
            <p className="text-[0.9rem]">Não foi possível carregar este vídeo.</p>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                resumeRef.current =
                  positionRef.current > 0 ? positionRef.current : resumeRef.current;
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <VideoPlayer
            key={attempt}
            hlsSrc={video.hls_url}
            src={video.hls_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            autoPlay
            className="h-full w-full"
            {...handlers}
            onFatalError={() => setFailed(true)}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 8,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{video.title}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          <button type="button" style={linkButton} onClick={() => onOpenInHelpCenter(video.slug)}>
            Ver na Central de Ajuda
          </button>
          <button type="button" style={linkButton} onClick={onClose}>
            Fechar vídeo
          </button>
        </span>
      </div>
    </div>
  );
}
```

Check `apps/crm/src/lib/utils.ts` exports `cn` (button.tsx imports it from `@/lib/utils`). If `../../lib/utils` does not resolve, use the same path `button.tsx` uses.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideVideoCard.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide/GuideVideoCard.tsx apps/crm/src/components/guide/__tests__/GuideVideoCard.test.tsx
git commit -m "feat(guia): card de tutorial em vídeo com player embutido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire videos into `GuideDialog`

**Files:**
- Create: `apps/crm/src/components/guide/GuideVideoSlot.tsx`
- Modify: `apps/crm/src/components/guide/GuideDialog.tsx` (imports; `HomeView` after the intro `<p>`; `PageView` between the recap block and the action block)
- Modify: `apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx` (mock video hooks; new tests)

**Interfaces:**
- Consumes: `GuideVideoCard` (Task 3); `GUIDE_HOME_VIDEO`, `GUIDE_MORE_SERIES`, `GuidePage.videoSlug` (Task 2); `useKbVideoSeries`, `useVideoProgress` from `pages/ajuda/videos/useKbVideos`; `useGuide` (`setLastPage`, `closeForAction`).
- Produces:
  ```ts
  export function findVideoBySlug(series: KbVideoSeries[], slug: string): KbVideo | null;
  export function GuideVideoSlot(p: { slug: string; pageId: string; variant: 'featured' | 'inline' }): JSX.Element | null;
  export function GuideMoreVideos(p: { seriesSlug: string; pageId: string }): JSX.Element | null;
  ```

- [ ] **Step 1: Update the dialog test (failing)**

In `GuideDialog.test.tsx`, right after the existing `vi.mock('../../../lib/analytics', ...)` line add:

```tsx
const videos = vi.hoisted(() => ({ series: { data: undefined as unknown } }));
vi.mock('../../../pages/ajuda/videos/useKbVideos', () => ({
  useKbVideoSeries: () => videos.series,
  useVideoProgress: () => ({ progress: new Map(), save: vi.fn(), isLoading: false }),
}));

function v(id: number, slug: string, title: string, series_id: string) {
  return {
    id,
    series_id,
    title,
    slug,
    description: null,
    display_order: id,
    duration_seconds: 60,
    hls_url: `https://h/${id}.m3u8`,
    thumbnail_url: null,
    article: null,
  };
}

const SERIES = [
  {
    id: 's1',
    title: 'Primeiros Passos',
    slug: 'primeiros-passos',
    description: null,
    display_order: 1,
    videos: [v(1, 'primeiro-acesso', 'Primeiro acesso', 's1'), v(4, 'conectar-instagram', 'Instagram', 's1')],
  },
  {
    id: 's2',
    title: 'Indo Além',
    slug: 'indo-alem',
    description: null,
    display_order: 2,
    videos: [v(9, 'metricas-do-instagram', 'Métricas do Instagram', 's2'), v(10, 'automacoes', 'Automações', 's2')],
  },
];
```

Add `beforeEach` to the vitest import, and at the top of `describe('GuideDialog', ...)`:

```tsx
  beforeEach(() => {
    videos.series = { data: SERIES };
  });
```

Append these tests inside the `describe`:

```tsx
  it('home mostra o vídeo em destaque', () => {
    renderDialog(makeApi());
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Primeiro acesso' })).toBeInTheDocument();
  });

  it('página com vídeo publicado mostra o card', () => {
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
  });

  it('slug sem vídeo publicado não mostra nada', () => {
    renderDialog(makeApi({ currentPageId: 't1p2' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('carregando: sem card', () => {
    videos.series = { data: undefined };
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('Ver na Central de Ajuda sai do guia sem dismissal e abre o vídeo', () => {
    const api = makeApi({ currentPageId: 't1p3' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver na Central de Ajuda' }));
    expect(api.setLastPage).toHaveBeenCalledWith('t1p3');
    expect(api.closeForAction).toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/ajuda/video/conectar-instagram');
  });

  it('fechamento sugere a série Indo Além', () => {
    const api = makeApi({ currentPageId: 't3p6' });
    renderDialog(api);
    expect(screen.getByText('Quando quiser ir além')).toBeInTheDocument();
    expect(screen.getByText('Métricas do Instagram')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver vídeos' }));
    expect(api.closeForAction).toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/ajuda/video/metricas-do-instagram');
  });

  it('fechamento sem a série publicada não mostra o bloco', () => {
    videos.series = { data: [SERIES[0]] };
    renderDialog(makeApi({ currentPageId: 't3p6' }));
    expect(screen.queryByText('Quando quiser ir além')).not.toBeInTheDocument();
  });
```

Note: the expanded card renders a `<video>`; add the same `canPlayType` stub as `GuideVideoCard.test.tsx` to this file's `beforeEach` (and `afterEach` cleanup) so `VideoPlayer` takes the native-HLS path.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx`
Expected: the 7 new tests FAIL (no cards/block); existing tests still pass.

- [ ] **Step 3: Create `GuideVideoSlot.tsx`**

```tsx
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { useGuide } from './GuideContext';
import { GuideVideoCard } from './GuideVideoCard';
import { useKbVideoSeries, useVideoProgress } from '../../pages/ajuda/videos/useKbVideos';
import { formatDuration } from '../../pages/ajuda/videos/playlist';
import type { KbVideo, KbVideoSeries } from '../../store/kbVideos';

export function findVideoBySlug(series: KbVideoSeries[], slug: string): KbVideo | null {
  for (const s of series) {
    const found = s.videos.find((v) => v.slug === slug);
    if (found) return found;
  }
  return null;
}

/** Sai do guia para a Central de Ajuda como o "Fazer agora" sai: sem dismissal, e o guia
 * reabre nesta página. */
function useOpenInHelpCenter(pageId: string) {
  const g = useGuide();
  const navigate = useNavigate();
  return (slug: string) => {
    if (pageId !== 'home') g?.setLastPage(pageId);
    g?.closeForAction();
    navigate(`/ajuda/video/${slug}`);
  };
}

/** Só é renderizado dentro do DialogContent, então as queries de vídeo só rodam com o guia
 * aberto. Slug sem vídeo publicado (rascunho, processando ou renomeado) não renderiza nada. */
export function GuideVideoSlot({
  slug,
  pageId,
  variant,
}: {
  slug: string;
  pageId: string;
  variant: 'featured' | 'inline';
}) {
  const { data: series } = useKbVideoSeries();
  const { progress, save } = useVideoProgress();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const video = useMemo(() => findVideoBySlug(series ?? [], slug), [series, slug]);
  if (!video) return null;
  return (
    <GuideVideoCard
      key={video.id}
      video={video}
      progress={progress}
      onSave={save}
      pageId={pageId}
      variant={variant}
      onOpenInHelpCenter={openInHelpCenter}
    />
  );
}

/** Bloco da página de fechamento que aponta para a próxima série. */
export function GuideMoreVideos({ seriesSlug, pageId }: { seriesSlug: string; pageId: string }) {
  const { data: series } = useKbVideoSeries();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const s = series?.find((x) => x.slug === seriesSlug);
  if (!s || s.videos.length === 0) return null;
  const count = s.videos.length;
  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        padding: '14px 15px',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Série {s.title} · {count} {count === 1 ? 'vídeo' : 'vídeos'}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '0.875rem', fontWeight: 600 }}>
        Quando quiser ir além
      </p>
      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}
      >
        {s.videos.map((video) => {
          const duration = formatDuration(video.duration_seconds);
          return (
            <li
              key={video.id}
              style={{
                borderRadius: 8,
                background: 'var(--surface-2, #eceef2)',
                padding: 10,
                fontSize: '0.75rem',
                fontWeight: 600,
                lineHeight: 1.35,
              }}
            >
              {video.title}
              {duration && (
                <span
                  style={{
                    display: 'block',
                    marginTop: 4,
                    fontWeight: 400,
                    color: 'var(--text-muted)',
                  }}
                >
                  {duration}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Ficam na Central de Ajuda, junto com os vídeos do guia.
        </p>
        <Button variant="outline" size="sm" onClick={() => openInHelpCenter(s.videos[0].slug)}>
          Ver vídeos
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `GuideDialog.tsx`**

Imports — change the `guideContent` import and add the slot import:

```tsx
import {
  GUIDE_HOME_VIDEO,
  GUIDE_MORE_SERIES,
  requiredSignals,
  type GuidePage,
  type GuideTrail,
} from './guideContent';
import { GuideMoreVideos, GuideVideoSlot } from './GuideVideoSlot';
```

In `HomeView`, directly after the intro paragraph that ends with `o guia continua de onde parou.` and its closing `</p>`, add:

```tsx
      <GuideVideoSlot slug={GUIDE_HOME_VIDEO} pageId="home" variant="featured" />
```

In `PageView`, between the `{page.recap && (...)}` block and the `{page.action && (...)}` block, add:

```tsx
      {page.videoSlug && (
        <GuideVideoSlot slug={page.videoSlug} pageId={page.id} variant="inline" />
      )}
      {page.conclude && <GuideMoreVideos seriesSlug={GUIDE_MORE_SERIES} pageId={page.id} />}
```

- [ ] **Step 5: Run the guide + layout suites**

Run: `npx vitest run apps/crm/src/components/guide apps/crm/src/components/layout`
Expected: all pass. If `AppLayout.test.tsx` fails with "No QueryClient set", it renders the guide open: add the same `useKbVideos` mock there rather than changing production code.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/guide/GuideVideoSlot.tsx apps/crm/src/components/guide/GuideDialog.tsx apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx
git commit -m "feat(guia): tutoriais em vídeo no Guia de primeiros passos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Gates, browser check, PR

**Files:** none new (fixes only if a gate fails).

- [ ] **Step 1: CI gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all clean (`npm run format` to fix formatting). No edge-function change, so `check:functions`/`test:functions` are not affected; run them anyway only if time allows, then `npm ci` if `node_modules/.deno` appears.

- [ ] **Step 2: Browser check**

Start the CRM against prod data (`npm run dev:env` via `.claude/launch.json`), sign in with the seed login (memory `reference_seed_login_browser_verification`), open the guide from the sidebar entry and check:
1. Home: featured "Primeiro acesso" card with thumbnail and `0:54`.
2. Trilha 1 → página 3: "Instagram" card; click plays inline; `Fechar vídeo` returns to the card.
3. After watching past 90%, `/ajuda` shows the video as watched.
4. Dark mode (`data-theme="dark"`) and 375px width: card legible, pill hidden, no horizontal scroll.
5. Last page of trilha 3: "Quando quiser ir além" block, `Ver vídeos` lands on `/ajuda/video/metricas-do-instagram`.

Screenshot each for the PR.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin claude/onboarding-videos-popup-5291ab
gh pr create --base main --title "feat(guia): tutoriais em vídeo no Guia de primeiros passos" --body "<summary, spec + mockups links, screenshots, note that the Admin popup draft a1a89480 is separate and activated by hand>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
