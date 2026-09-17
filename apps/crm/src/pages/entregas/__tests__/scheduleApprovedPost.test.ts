import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scheduleInstagramPost: vi.fn(async () => ({ ok: true, status: 'agendado' })),
  scheduleTikTokPost: vi.fn(async () => ({ ok: true, status: 'agendado' })),
}));

vi.mock('@/services/instagram', () => ({ scheduleInstagramPost: mocks.scheduleInstagramPost }));
vi.mock('@/services/tiktok', () => ({ scheduleTikTokPost: mocks.scheduleTikTokPost }));

import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';

const scheduleInstagramPost = mocks.scheduleInstagramPost;
const scheduleTikTokPost = mocks.scheduleTikTokPost;

const FUTURE = '2026-09-18T12:00:00.000Z';

describe('scheduleApprovedPost', () => {
  beforeEach(() => {
    scheduleInstagramPost.mockClear();
    scheduleTikTokPost.mockClear();
  });

  it('routes an instagram post to the Instagram service', async () => {
    await scheduleApprovedPost({ id: 1, platform: 'instagram', scheduled_at: FUTURE });
    expect(scheduleInstagramPost).toHaveBeenCalledWith(1);
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });

  it('treats a missing platform as instagram (legacy rows, DB default)', async () => {
    await scheduleApprovedPost({ id: 2, platform: undefined, scheduled_at: FUTURE });
    expect(scheduleInstagramPost).toHaveBeenCalledWith(2);
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });

  it('routes a tiktok post to the TikTok service with its date', async () => {
    await scheduleApprovedPost({ id: 3, platform: 'tiktok', scheduled_at: FUTURE });
    expect(scheduleTikTokPost).toHaveBeenCalledWith(3, FUTURE);
    expect(scheduleInstagramPost).not.toHaveBeenCalled();
  });

  // Decision 6: 'both' calls ONLY the TikTok service -- its server validates
  // both platforms. Calling both services here would double-schedule.
  it("routes platform 'both' to the TikTok service only", async () => {
    await scheduleApprovedPost({ id: 4, platform: 'both', scheduled_at: FUTURE });
    expect(scheduleTikTokPost).toHaveBeenCalledWith(4, FUTURE);
    expect(scheduleInstagramPost).not.toHaveBeenCalled();
  });

  it('propagates the service error so callers can toast it', async () => {
    scheduleInstagramPost.mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'));
    await expect(
      scheduleApprovedPost({ id: 5, platform: 'instagram', scheduled_at: FUTURE }),
    ).rejects.toThrow('Legenda do Instagram não definida.');
  });
});

describe('scheduleSuccessMessage', () => {
  it('names the platform(s) the post went to', () => {
    expect(scheduleSuccessMessage('instagram')).toBe('Post agendado para publicação no Instagram');
    expect(scheduleSuccessMessage('tiktok')).toBe('Post agendado para publicação no TikTok');
    expect(scheduleSuccessMessage('both')).toBe(
      'Post agendado para publicação no Instagram e no TikTok',
    );
  });
});
