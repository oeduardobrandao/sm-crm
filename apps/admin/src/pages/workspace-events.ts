import type { WorkspaceEvent } from '../lib/api';

interface EventMeta {
  label: string;
  icon: string;
}

const ACTION_MAP: Record<string, EventMeta> = {
  'client-create': { label: 'Cliente criado', icon: 'UserPlus' },
  'accept-invite': { label: 'Convite aceito', icon: 'UserCheck' },
  'admin-create-invite': { label: 'Convite enviado', icon: 'Mail' },
  'admin-resend-invite': { label: 'Convite reenviado', icon: 'MailCheck' },
  'admin-cancel-invite': { label: 'Convite cancelado', icon: 'MailX' },
  'instagram-link': { label: 'Instagram conectado', icon: 'Link' },
  'tiktok-link': { label: 'TikTok conectado', icon: 'Link' },
  'post-published': { label: 'Post publicado', icon: 'Send' },
  'post-scheduled': { label: 'Post agendado', icon: 'Clock' },
  'post-publish_failed': { label: 'Publicacao falhou', icon: 'AlertTriangle' },
  'update-role': { label: 'Cargo alterado', icon: 'Shield' },
  'remove-user': { label: 'Membro removido', icon: 'UserMinus' },
  'mcp.key.create': { label: 'API key criada', icon: 'Key' },
  'mcp.key.revoke': { label: 'API key revogada', icon: 'KeyRound' },
  'mcp.oauth.grant': { label: 'OAuth conectado', icon: 'Plug' },
  'mcp.oauth.revoke': { label: 'OAuth revogado', icon: 'Unplug' },
  import_commit_batch: { label: 'Importacao concluida', icon: 'Upload' },
  import_undo: { label: 'Importacao desfeita', icon: 'Undo2' },
  instagram_connected_by_client: { label: 'Instagram conectado (cliente)', icon: 'Link' },
};

export function eventMeta(action: string): EventMeta {
  return ACTION_MAP[action] ?? { label: action.replace(/[-_.]/g, ' '), icon: 'Activity' };
}

export function eventDescription(event: WorkspaceEvent): string {
  const meta = event.metadata as Record<string, unknown> | null;
  if (!meta) return '';

  switch (event.action) {
    case 'client-create':
      return (meta.nome as string) ?? '';
    case 'post-published':
    case 'post-scheduled':
    case 'post-publish_failed':
      return meta.actor_name ? `por ${meta.actor_name}` : '';
    case 'update-role':
    case 'remove-user':
      return event.resource_id ?? '';
    default:
      return '';
  }
}

export const FILTERABLE_TYPES = [
  { value: 'client-create', label: 'Cliente criado' },
  { value: 'accept-invite', label: 'Convite aceito' },
  { value: 'admin-create-invite', label: 'Convite enviado' },
  { value: 'instagram-link', label: 'Instagram conectado' },
  { value: 'tiktok-link', label: 'TikTok conectado' },
  { value: 'post-published', label: 'Post publicado' },
  { value: 'post-scheduled', label: 'Post agendado' },
  { value: 'update-role', label: 'Cargo alterado' },
  { value: 'remove-user', label: 'Membro removido' },
] as const;
