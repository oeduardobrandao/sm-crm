import { useQuery } from '@tanstack/react-query';
import { getKbViewStats } from './api';

export const KB_VIEW_STATS_KEY = ['admin', 'kb-view-stats'] as const;

/** Separate from the list queries: a failed or slow stats call never blocks the lists. */
export function useKbViewStats() {
  return useQuery({ queryKey: KB_VIEW_STATS_KEY, queryFn: getKbViewStats, staleTime: 60_000 });
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

export const formatViews = (n: number) => (n === 1 ? '1 visualização' : `${fmt(n)} visualizações`);
export const formatPeople = (n: number) => (n === 1 ? '1 pessoa' : `${fmt(n)} pessoas`);
export const formatCompleted = (n: number) => (n === 1 ? '1 concluiu' : `${fmt(n)} concluíram`);
