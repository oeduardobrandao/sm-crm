import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface IgAccountStatus {
  revoked: boolean;
  expired: boolean;
  canPublish: boolean;
}

export interface TtAccountStatus {
  revoked: boolean;
  expired: boolean;
}

export interface ClienteSocialAccounts {
  hasInstagramAccount: boolean;
  igAccountStatus: IgAccountStatus | null;
  hasActiveTikTokAccount: boolean;
  ttAccountStatus: TtAccountStatus | null;
}

/**
 * Cliente-scoped Instagram/TikTok account presence + status, read directly via
 * the supabase client (not through store.ts). Extracted out of WorkflowDrawer
 * so any post editor surface scoped to a cliente -- inside a workflow drawer or
 * standalone -- can gate its PlatformSelector/ScheduleButton/TikTokSettingsPanel
 * the same way without duplicating the two queries.
 */
export function useClienteSocialAccounts(clienteId: number): ClienteSocialAccounts {
  const { data: igAccount } = useQuery({
    queryKey: ['igAccountForWorkflow', clienteId],
    queryFn: async () => {
      const { data: account } = await supabase
        .from('instagram_accounts')
        .select('id, authorization_status, token_expires_at, permissions')
        .eq('client_id', clienteId)
        .maybeSingle();
      return account;
    },
    enabled: !!clienteId,
  });
  const hasInstagramAccount = !!igAccount;
  const igAccountStatus = igAccount
    ? {
        revoked: igAccount.authorization_status === 'revoked',
        expired:
          igAccount.authorization_status === 'expired' ||
          (igAccount.token_expires_at ? new Date(igAccount.token_expires_at) < new Date() : false),
        canPublish:
          Array.isArray(igAccount.permissions) &&
          igAccount.permissions.includes('instagram_business_content_publish'),
      }
    : null;

  // Lightweight signal for the platform selector's gating -- mirrors the igAccount
  // query above (direct RLS read, no tiktok.ts round trip/cache needed here).
  const { data: ttAccount } = useQuery({
    queryKey: ['ttAccountForWorkflow', clienteId],
    queryFn: async () => {
      const { data: account } = await supabase
        .from('tiktok_accounts')
        .select('id, authorization_status')
        .eq('client_id', clienteId)
        .maybeSingle();
      return account;
    },
    enabled: !!clienteId,
  });
  const hasActiveTikTokAccount = ttAccount?.authorization_status === 'active';
  // ScheduleButton's TikTok analogue of igAccountStatus above -- same query, no round trip
  // added. `tiktok_accounts.authorization_status` has no separate "missing publish scope"
  // concept (unlike Instagram's `permissions` array), so there's no `canPublish` field here.
  const ttAccountStatus = ttAccount
    ? {
        revoked: ttAccount.authorization_status === 'revoked',
        expired: ttAccount.authorization_status === 'expired',
      }
    : null;

  return { hasInstagramAccount, igAccountStatus, hasActiveTikTokAccount, ttAccountStatus };
}
