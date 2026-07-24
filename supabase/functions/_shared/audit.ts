// deno-lint-ignore-file no-explicit-any
export async function insertAuditLog(
  svc: { from: (table: string) => any },
  entry: {
    conta_id?: string;
    actor_user_id?: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await svc.from('audit_log').insert(entry);
    // supabase-js RESOLVES with { error } rather than throwing, so the catch
    // below never sees a rejected insert — this check is what makes an audit
    // write failure visible at all.
    if (error) console.error('[audit] Failed to write audit log:', error);
  } catch (e) {
    // Audit log failure must never break the primary operation
    console.error('[audit] Failed to write audit log:', e);
  }
}
