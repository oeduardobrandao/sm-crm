import type { AdminMcpGrant } from '../../lib/api';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const CONNECTOR_URL = `${SUPABASE_URL}/functions/v1/mcp-admin`;

export const OAUTH_HELP =
  'Campos de OAuth ficam em branco. Na tela de autorização, escolha Administração da plataforma.';

export function truncateClientId(clientId: string): string {
  return clientId.length > 12 ? `${clientId.slice(0, 12)}…` : clientId;
}

export function formatGrantDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function scopeCount(grant: AdminMcpGrant): string {
  const n = grant.scopes.length;
  return `${n} ${n === 1 ? 'escopo' : 'escopos'}`;
}

/** What IntegrationsPage hands to its phone and desktop views: data and handlers, no queries. */
export interface IntegrationsViewProps {
  grants: AdminMcpGrant[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onCopy: () => void;
  onRevoke: (grant: AdminMcpGrant) => void;
  revoking: boolean;
}
