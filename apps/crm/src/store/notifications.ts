import { supabase } from './core';

export type NotificationType =
  | 'post_approved' | 'post_correction' | 'post_message' | 'post_edit_suggestion'
  | 'idea_submitted' | 'briefing_answered'
  | 'step_activated' | 'step_completed' | 'post_assigned'
  | 'workflow_completed' | 'deadline_approaching'
  | 'invite_accepted' | 'member_role_changed' | 'member_removed';

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

export async function getNotifications(limit = 50, offset = 0): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .is('dismissed_at', null);
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

export async function markAllNotificationsAsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .is('dismissed_at', null);
  if (error) throw error;
}

export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
