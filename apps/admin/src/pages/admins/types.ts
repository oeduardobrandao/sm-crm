import type { FormEvent } from 'react';
import type { PlatformAdmin } from '../../lib/api';

/** What AdminsPage hands to its phone and desktop views: data and handlers, no queries. */
export interface AdminsViewProps {
  admins: PlatformAdmin[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  currentUserId: string | undefined;
  email: string;
  onEmailChange: (email: string) => void;
  onInvite: (e: FormEvent) => void;
  inviting: boolean;
  onRemove: (adminId: string) => void;
  removing: boolean;
}

export const INVITE_HELP = 'A pessoa recebe acesso total ao Admin.';

export function formatAdminDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}
