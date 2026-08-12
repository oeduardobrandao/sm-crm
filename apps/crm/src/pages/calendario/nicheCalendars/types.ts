export type NicheEventType = 'br' | 'world' | 'prof' | 'week' | 'month';

export interface NicheEvent {
  date: string;
  name: string;
  type: NicheEventType;
  tags: string[];
}

export interface NicheMonth {
  month: string;
  num: string;
  badge?: string;
  events: NicheEvent[];
}

export interface NicheCalendarDef {
  key: string;
  label: string;
  title: string;
  subtitle: string;
  data: NicheMonth[];
  filterLabels: Record<string, string>;
}

export const dotColorMap: Record<string, string> = {
  br: '#eab308',
  world: '#14b8a6',
  prof: '#f59e0b',
  week: '#ec4899',
  month: '#ef4444',
};
