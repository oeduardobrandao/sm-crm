import { supabase } from './core';

export type NotificationEmailType =
  | 'post_publish_failed'
  | 'post_correction'
  | 'post_message'
  | 'client_message'
  | 'deadline_approaching'
  | 'task_assigned'
  | 'post_assigned'
  | 'mention';

export const MASTER_PAUSE_TYPE = '__all__' as const;

/** UI order + PT copy. No em dashes (period/colon/·). */
export const EMAIL_NOTIFICATION_TYPES: {
  type: NotificationEmailType;
  label: string;
  description: string;
}[] = [
  {
    type: 'post_publish_failed',
    label: 'Falha ao publicar',
    description: 'Quando um post agendado falha ao ser publicado no Instagram.',
  },
  {
    type: 'post_correction',
    label: 'Correção do cliente',
    description: 'Quando um cliente pede alteração em um post.',
  },
  {
    type: 'post_message',
    label: 'Mensagem em um post',
    description: 'Quando um cliente comenta em um post específico.',
  },
  {
    type: 'client_message',
    label: 'Mensagem do cliente',
    description: 'Quando um cliente envia uma mensagem na conversa.',
  },
  {
    type: 'deadline_approaching',
    label: 'Prazo se aproximando',
    description: 'Quando uma etapa vence no dia seguinte.',
  },
  {
    type: 'task_assigned',
    label: 'Tarefa atribuída a você',
    description: 'Quando uma tarefa é atribuída a você.',
  },
  {
    type: 'post_assigned',
    label: 'Post atribuído a você',
    description: 'Quando um post é atribuído a você.',
  },
  {
    type: 'mention',
    label: 'Menções',
    description: 'Quando alguém menciona você com @.',
  },
];

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not authenticated');
  return data.user.id;
}

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
  const user_id = await currentUserId();
  const { error } = await supabase
    .from('notification_email_prefs')
    .upsert(
      { user_id, type, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  if (error) throw error;
}
