/** Returns the feature flag required for an instagram-analytics path+method, or null if always-allowed. */
export function featureForPath(method: string, path: string): string | null {
  if (/^\/demographics\//.test(path)) return "feature_audience_demographics";
  if (/^\/best-times\//.test(path)) return "feature_best_times";
  if (/^\/ai-analysis(\/|-portfolio$)/.test(path)) return "feature_instagram_ai";
  if (
    /^\/generate-report\//.test(path) || /^\/reports\//.test(path) ||
    /^\/report-download\//.test(path) || path === "/send-report-email"
  ) return "feature_analytics_reports";
  if (/^\/tags(\/|$)/.test(path) || /^\/posts\/[^/]+\/tags/.test(path)) {
    // tag *mutations* are gated; reads are free
    return method === "GET" ? null : "feature_post_tagging";
  }
  // overview / posts-analytics / follower-history / portfolio => base
  return "feature_instagram";
}
