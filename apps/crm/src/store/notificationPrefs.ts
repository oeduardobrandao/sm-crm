import { supabase, getUserId } from './core';
import type { NotificationType } from './notifications';
import {
  EMAIL_ELIGIBLE_TYPES,
  NOTIFICATION_CATALOG,
  type NotificationEmailType,
  type NotificationPushType,
} from '@/lib/notification-catalog';

export type { NotificationEmailType, NotificationPushType } from '@/lib/notification-catalog';

export const MASTER_PAUSE_TYPE = '__all__' as const;

/** Derivado do catálogo (fonte única de ordem e copy): um item por tipo emailEligible. */
export const EMAIL_NOTIFICATION_TYPES: {
  type: NotificationEmailType;
  label: string;
  description: string;
}[] = EMAIL_ELIGIBLE_TYPES.map((type) => ({
  type,
  label: NOTIFICATION_CATALOG[type].label,
  description: `Quando ${NOTIFICATION_CATALOG[type].when}.`,
}));

/** Returns a map of type → enabled. Types absent from the map default to true. */
export async function getNotificationEmailPrefs(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('notification_email_prefs').select('type, enabled');
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.type as string] = row.enabled as boolean;
  return map;
}

export async function setNotificationEmailPref(
  type: NotificationEmailType | typeof MASTER_PAUSE_TYPE,
  enabled: boolean,
): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('notification_email_prefs')
    .upsert(
      { user_id, type, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  if (error) throw error;
}

/** Returns a map of type → enabled. Types absent from the map default to true. */
export async function getNotificationInappPrefs(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('notification_inapp_prefs').select('type, enabled');
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.type as string] = row.enabled as boolean;
  return map;
}

export async function setNotificationInappPref(
  type: NotificationType | typeof MASTER_PAUSE_TYPE,
  enabled: boolean,
): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('notification_inapp_prefs')
    .upsert(
      { user_id, type, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  if (error) throw error;
}

/** Push (iOS app) prefs: same shape as the e-mail pair, own table (20261015000001).
 * Types absent from the map default to true. */
export async function getNotificationPushPrefs(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('notification_push_prefs').select('type, enabled');
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.type as string] = row.enabled as boolean;
  return map;
}

export async function setNotificationPushPref(
  type: NotificationPushType | typeof MASTER_PAUSE_TYPE,
  enabled: boolean,
): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('notification_push_prefs')
    .upsert(
      { user_id, type, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  if (error) throw error;
}

/** Whether the signed-in user has an app installed that receives push. RLS limits
 * push_devices to the caller's own rows, and the column grant excludes `token` and
 * `user_id`, so this selects only `id`. */
export async function hasActivePushDevice(): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_devices')
    .select('id')
    .is('disabled_at', null)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** 'all' quando o master pause está ativo; senão os types explicitamente off.
 * Ordenado: a lista entra em queryKeys do TanStack, e a ordem de
 * Object.entries não é estável entre respostas do banco. */
export function mutedInappTypes(prefs: Record<string, boolean>): string[] | 'all' {
  if (prefs[MASTER_PAUSE_TYPE] === false) return 'all';
  return Object.entries(prefs)
    .filter(([t, on]) => !on && t !== MASTER_PAUSE_TYPE)
    .map(([t]) => t)
    .sort();
}
