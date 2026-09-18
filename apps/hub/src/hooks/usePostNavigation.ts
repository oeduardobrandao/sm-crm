import { useMemo } from 'react';
import type { HubPost } from '../types';

export interface PostNavigation {
  index: number;
  current: HubPost | null;
  prev: HubPost | null;
  next: HubPost | null;
  /** First post after the current one (wrapping) still awaiting approval; null if none. */
  nextPending: HubPost | null;
}

const EMPTY: PostNavigation = {
  index: -1,
  current: null,
  prev: null,
  next: null,
  nextPending: null,
};

export function computePostNavigation(posts: HubPost[], currentId: number | null): PostNavigation {
  if (currentId === null) return EMPTY;
  const index = posts.findIndex((p) => p.id === currentId);
  if (index === -1) return EMPTY;
  let nextPending: HubPost | null = null;
  for (let step = 1; step < posts.length; step++) {
    const candidate = posts[(index + step) % posts.length];
    if (candidate.status === 'enviado_cliente') {
      nextPending = candidate;
      break;
    }
  }
  return {
    index,
    current: posts[index],
    prev: index > 0 ? posts[index - 1] : null,
    next: index < posts.length - 1 ? posts[index + 1] : null,
    nextPending,
  };
}

export function usePostNavigation(posts: HubPost[], currentId: number | null): PostNavigation {
  return useMemo(() => computePostNavigation(posts, currentId), [posts, currentId]);
}
