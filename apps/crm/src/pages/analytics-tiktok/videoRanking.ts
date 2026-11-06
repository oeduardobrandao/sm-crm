// Video ranking, filtering and sorting shared by the TikTok overview page (/analytics/tiktok)
// and the client TikTok tab (/analytics/:id/tiktok). Generic over the few fields they read, so
// portfolio videos and per-client videos go through the same rules.

/** Videos younger than this have not had time to collect views: "Precisam de atenção" skips them. */
export const MATURE_AFTER_MS = 48 * 60 * 60 * 1000;

/** São Paulo has no DST (since 2019), so a fixed offset gives the SP day boundaries. */
export const SP_OFFSET = '-03:00';

/** Epoch ms of the first instant of a São Paulo day (YYYY-MM-DD). */
export const spDayStartMs = (date: string): number =>
  new Date(`${date}T00:00:00${SP_OFFSET}`).getTime();

/** Epoch ms of the last instant of a São Paulo day (YYYY-MM-DD). */
export const spDayEndMs = (date: string): number =>
  new Date(`${date}T23:59:59.999${SP_OFFSET}`).getTime();

interface Posted {
  posted_at: string | null;
}
interface RankedVideo extends Posted {
  views: number | null;
}

/** posted_at in epoch ms; 0 when unknown. */
export const postedMs = (v: Posted): number => (v.posted_at ? new Date(v.posted_at).getTime() : 0);

/** A sorted copy; null keys go last whichever way it sorts. */
export function sortNullsLast<T>(
  list: readonly T[],
  key: (item: T) => number | null,
  asc: boolean,
) {
  const dir = asc ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir;
  });
}

/** Items posted within the inclusive São Paulo days [from, to]; an empty bound is open. */
export function filterByPostedRange<T extends Posted>(
  list: readonly T[],
  from: string,
  to: string,
) {
  const start = from ? spDayStartMs(from) : null;
  const end = to ? spDayEndMs(to) : null;
  return list.filter((v) => {
    const t = postedMs(v);
    return (start === null || t >= start) && (end === null || t <= end);
  });
}

/**
 * `best`: every video, most viewed first. `worst`: the ones posted more than 48h ago, fewest
 * views first (Instagram parity).
 */
export function rankByViews<T extends RankedVideo>(
  videos: readonly T[],
  now: number = Date.now(),
): { best: T[]; worst: T[] } {
  const cutoff = now - MATURE_AFTER_MS;
  return {
    best: [...videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)),
    worst: videos
      .filter((v) => v.posted_at !== null && postedMs(v) < cutoff)
      .sort((a, b) => (a.views ?? 0) - (b.views ?? 0)),
  };
}
