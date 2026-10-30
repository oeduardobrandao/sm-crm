import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  TikTokCoverFrameDialog,
  coverMsFromPlayhead,
  formatCoverTimestamp,
} from '../TikTokCoverFrameDialog';
import type { PostMedia } from '../../../../store';

describe('coverMsFromPlayhead', () => {
  it('rounds the playhead to whole milliseconds', () => {
    expect(coverMsFromPlayhead(5.2504, 42)).toBe(5250);
    expect(coverMsFromPlayhead(0, 42)).toBe(0);
  });

  it('keeps the value strictly inside the video', () => {
    expect(coverMsFromPlayhead(42, 42)).toBe(41999);
    expect(coverMsFromPlayhead(-1, 42)).toBe(0);
  });

  it('passes the playhead through while the duration is unknown', () => {
    expect(coverMsFromPlayhead(3, Number.NaN)).toBe(3000);
  });
});

describe('formatCoverTimestamp', () => {
  it('formats as m:ss.s', () => {
    expect(formatCoverTimestamp(0)).toBe('0:00.0');
    expect(formatCoverTimestamp(3250)).toBe('0:03.2');
    expect(formatCoverTimestamp(75_900)).toBe('1:15.9');
  });
});

describe('TikTokCoverFrameDialog', () => {
  it('shows the unavailable placeholder and blocks saving for a lost video', () => {
    render(
      <TikTokCoverFrameDialog
        media={
          {
            id: 1,
            kind: 'video',
            url: null,
            thumbnail_url: null,
            media_lost_at: '2026-08-14T03:00:00.000Z',
          } as unknown as PostMedia
        }
        valueMs={undefined}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar este quadro' })).toBeDisabled();
  });
});
