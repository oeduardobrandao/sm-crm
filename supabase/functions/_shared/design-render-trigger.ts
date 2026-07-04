// Fire-and-forget design-render kick — the ONE implementation of the internal trigger
// (design-manage create/save/attach paths, instagram-publish/hub-approve T4.1 re-triggers). 409 = a
// render is already in flight (claim lost) and 204 = nothing to do; both are success here.
export function createDesignRenderTrigger(supabaseUrl: string, cronSecret: string) {
  return async (designId: number, rev: number): Promise<void> => {
    const res = await fetch(`${supabaseUrl}/functions/v1/design-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
      body: JSON.stringify({ design_id: designId, rev }),
    });
    if (!res.ok && res.status !== 409 && res.status !== 204) {
      throw new Error(`design-render trigger returned ${res.status}`);
    }
  };
}
