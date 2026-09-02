import { supabase } from './core';

export type NotificationType =
  | 'post_approved'
  | 'post_correction'
  | 'post_message'
  | 'post_edit_suggestion'
  | 'idea_submitted'
  | 'briefing_answered'
  | 'step_activated'
  | 'step_completed'
  | 'post_assigned'
  | 'task_assigned'
  | 'workflow_completed'
  | 'deadline_approaching'
  | 'invite_accepted'
  | 'member_role_changed'
  | 'member_removed'
  | 'client_message'
  | 'mention'
  | 'post_status_automation'
  | 'instagram_connected_by_client'
  | 'post_publish_failed'
  | 'storage_autoclean_report'
  | 'instagram_automation_failed'
  | 'team_message';

export interface Notification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: NotificationType;
  metadata: Record<string, unknown>;
  link: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

/** Applies a NOT IN filter on `type` when excludeTypes is non-empty. No-op otherwise. */
function withoutTypes<T>(query: T, excludeTypes: string[]): T {
  if (!excludeTypes.length) return query;
  const list = `(${excludeTypes.map((t) => `"${t}"`).join(',')})`;
  // @ts-expect-error postgrest builder chain
  return query.not('type', 'in', list);
}

export async function getNotifications(
  limit = 50,
  offset = 0,
  excludeTypes: string[] = [],
): Promise<Notification[]> {
  const base = supabase.from('notifications').select('*').is('dismissed_at', null);
  const { data, error } = await withoutTypes(base, excludeTypes)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(excludeTypes: string[] = []): Promise<number> {
  const base = supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .is('dismissed_at', null);
  const { count, error } = await withoutTypes(base, excludeTypes);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationAsRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsAsRead(excludeTypes: string[] = []): Promise<void> {
  const base = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .is('dismissed_at', null);
  const { error } = await withoutTypes(base, excludeTypes);
  if (error) throw error;
}

export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
