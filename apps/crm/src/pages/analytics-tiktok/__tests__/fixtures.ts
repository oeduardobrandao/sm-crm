import i18n from 'i18next';
import pt from '../../../../../../packages/i18n/locales/pt/analyticsTiktok.json';
import en from '../../../../../../packages/i18n/locales/en/analyticsTiktok.json';
import type {
  TikTokPortfolio,
  TikTokPortfolioRow,
  TikTokPortfolioVideo,
} from '../../../services/tiktokAnalytics';

/** The shared vitest setup does not list the `analyticsTiktok` namespace; register it here. */
export function registerTikTokI18n() {
  i18n.addResourceBundle('pt', 'analyticsTiktok', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsTiktok', en, true, true);
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export function row(id: number, name: string, extra: Partial<TikTokPortfolioRow> = {}) {
  return {
    client_id: id,
    client_name: name,
    especialidade: 'Saúde',
    username: name.toLowerCase().replace(/\s/g, ''),
    avatar_url: null,
    authorization_status: 'active',
    follower_count: 1000,
    followers_gained: 10,
    views: 1000,
    engagement_rate: 2,
    posts_count: 1,
    last_posted_at: ago(2),
    ...extra,
  } as TikTokPortfolioRow;
}

export function video(
  id: string,
  client: { id: number; name: string },
  views: number,
  extra: Partial<TikTokPortfolioVideo> = {},
): TikTokPortfolioVideo {
  return {
    client_id: client.id,
    client_name: client.name,
    tiktok_video_id: id,
    title: `Video ${id}`,
    cover_image_url: null,
    share_url: `https://www.tiktok.com/@x/video/${id}`,
    posted_at: ago(10),
    views,
    likes: Math.round(views / 10),
    engagement_rate: 3,
    ...extra,
  };
}

const alpha = { id: 1, name: 'Alpha Studio' };
const bravo = { id: 2, name: 'Bravo Health' };
const zeta = { id: 3, name: 'Zeta Labs' };

export function portfolio(rows?: TikTokPortfolioRow[]): TikTokPortfolio {
  const accounts = rows ?? [
    row(1, 'Alpha Studio', {
      follower_count: 12000,
      followers_gained: 300,
      views: 50000,
      engagement_rate: 4.5,
      posts_count: 6,
      last_posted_at: ago(2),
    }),
    row(2, 'Bravo Health', {
      follower_count: 8000,
      followers_gained: -20,
      views: 20000,
      engagement_rate: 1.5,
      posts_count: 3,
      last_posted_at: ago(5),
    }),
    row(3, 'Zeta Labs', {
      especialidade: 'Design',
      follower_count: 3000,
      followers_gained: null,
      views: null,
      engagement_rate: null,
      posts_count: 0,
      last_posted_at: ago(12),
    }),
  ];
  return {
    window: {
      start: '2026-10-01',
      end: '2026-10-28',
      prevStart: '2026-09-03',
      prevEnd: '2026-09-30',
    },
    totals: accounts.length
      ? { accounts: 3, followers: 23000, views: 70000, engagement_rate: 3.8, posts_count: 9 }
      : { accounts: 0, followers: null, views: null, engagement_rate: null, posts_count: 0 },
    accounts,
    topVideos: [
      video('t1', alpha, 9000),
      video('t2', bravo, 8000),
      video('t3', alpha, 7000),
      video('t4', bravo, 6000),
      video('t5', alpha, 5000),
    ],
    bottomVideos: [
      video('b1', zeta, 10),
      video('b2', bravo, 20),
      video('b3', alpha, 30),
      video('b4', bravo, 40),
      // Younger than 48h: never a "needs attention" video.
      video('b5', alpha, 5, { posted_at: ago(0.5) }),
      // Also in the top list: the union is de-duplicated.
      video('t5', alpha, 5000),
    ],
  };
}
