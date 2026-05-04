const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280',
  starter: '#3b82f6',
  pro: '#8b5cf6',
  max: '#f43f5e',
  lifetime: '#10b981',
  enterprise: '#06b6d4',
  basic: '#6b7280',
  business: '#f59e0b',
  premium: '#a855f7',
};

const FALLBACK_PALETTE = [
  '#06b6d4', '#ec4899', '#6366f1', '#14b8a6',
  '#f97316', '#a855f7', '#ef4444', '#22d3ee',
];

export function getPlanColor(planName: string): string {
  const key = planName.toLowerCase().trim();
  if (PLAN_COLORS[key]) return PLAN_COLORS[key];

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}
