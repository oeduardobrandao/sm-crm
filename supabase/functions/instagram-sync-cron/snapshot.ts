interface AccountMetrics {
  followers_count: number | null | undefined;
  reach_28d: number | null | undefined;
  impressions_28d: number | null | undefined;
  profile_views_28d: number | null | undefined;
  website_clicks_28d: number | null | undefined;
}

export interface SnapshotRow {
  instagram_account_id: string;
  snapshot_date: string;
  followers_count: number | null;
  reach_28d: number | null;
  impressions_28d: number | null;
  profile_views_28d: number | null;
  website_clicks_28d: number | null;
}

export function buildSnapshotRow(
  accountId: string,
  metrics: AccountMetrics,
): SnapshotRow {
  const today = new Date().toISOString().split("T")[0];
  return {
    instagram_account_id: accountId,
    snapshot_date: today,
    followers_count: metrics.followers_count ?? null,
    reach_28d: metrics.reach_28d ?? null,
    impressions_28d: metrics.impressions_28d ?? null,
    profile_views_28d: metrics.profile_views_28d ?? null,
    website_clicks_28d: metrics.website_clicks_28d ?? null,
  };
}
