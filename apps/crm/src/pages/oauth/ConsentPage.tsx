import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import {
  listEligibleWorkspaces,
  prepareOAuthAuthorization,
  recordOAuthGrant,
  type EligibleWorkspace,
} from '@/services/mcp-oauth';
import {
  SCOPE_OPTIONS,
  AGENT_PRESET,
  ADMIN_SCOPE_OPTIONS,
  ADMIN_READ_PRESET,
  adminScopeLabel,
  isOwnerOnlyScope,
  ownerOnlyHelp,
  ownerOnlyScopeError,
  scopeLabel,
} from '@/lib/mcp-scopes';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';

// Details Supabase returns when the user must still consent (vs. an OAuthRedirect with redirect_url).
interface AuthDetails {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  scope: string;
}

type Phase = 'loading' | 'consent' | 'submitting' | 'redirecting' | 'error';

const PLATFORM = '__platform__';

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

export default function ConsentPage() {
  const { t } = useTranslation('mcp');
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') || params.get('authorizationId') || '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [workspaces, setWorkspaces] = useState<EligibleWorkspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(AGENT_PRESET);
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!authorizationId) {
      setErrorMsg(t('consent.invalidRequest'));
      setPhase('error');
      return;
    }
    (async () => {
      // Must run first: getAuthorizationDetails auto-approves an existing consent, and a consent
      // left over from a revoked connection would loop the client on a token `mcp` refuses.
      // Best effort: if it fails, the page behaves exactly as before.
      await prepareOAuthAuthorization(authorizationId).catch(() => undefined);
      if (cancelled) return;
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setErrorMsg(t('consent.loadFailed'));
        setPhase('error');
        return;
      }
      // Already consented → Supabase hands back a ready redirect URL.
      if ('redirect_url' in data) {
        setPhase('redirecting');
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data as AuthDetails);

      // Default the scope selection to what the request actually named (when it names MCP scopes);
      // otherwise offer the full read preset. The edge function re-bounds this server-side.
      const allowed: string[] = SCOPE_OPTIONS.map((s) => s.value);
      const requested = ((data as AuthDetails).scope || '')
        .split(/\s+/)
        .filter((s) => allowed.includes(s));
      setScopes(requested.length ? requested : AGENT_PRESET);

      try {
        const { workspaces: ws, platform_admin } = await listEligibleWorkspaces();
        if (cancelled) return;
        setWorkspaces(ws);
        setPlatformAdmin(platform_admin);
        // Preselect the first MCP-enabled workspace, else the first one, else platform admin.
        const preselected =
          (ws.find((w) => w.feature_mcp) ?? ws[0])?.id ?? (platform_admin ? PLATFORM : null);
        setSelected(preselected);
        // The scopes above default to the workspace preset — when the platform option is
        // what actually got preselected (no eligible workspace), swap to the admin preset
        // so the checklist and the submitted scopes match the `target: 'platform'` grant.
        if (preselected === PLATFORM) setScopes(ADMIN_READ_PRESET);
      } catch {
        if (cancelled) return;
        setWorkspaces([]);
      }
      setPhase('consent');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizationId]);

  const toggleScope = (value: string, checked: boolean) =>
    setScopes((prev) =>
      checked ? [...new Set([...prev, value])] : prev.filter((s) => s !== value),
    );

  const isPlatform = selected === PLATFORM;
  const selectWorkspace = (id: string) => {
    if (id === PLATFORM && !isPlatform) setScopes(ADMIN_READ_PRESET);
    if (id !== PLATFORM && isPlatform) setScopes(AGENT_PRESET);
    setSelected(id);
  };
  const scopeOptions = isPlatform ? ADMIN_SCOPE_OPTIONS : SCOPE_OPTIONS;

  const selectedWs = workspaces.find((w) => w.id === selected) ?? null;
  // A workspace grant can only carry scopes the user's own role there allows (the edge function
  // refuses the rest), and owner-only scopes (financeiro:*) only when they own that workspace.
  // `scopes` keeps what the user picked; this is what actually gets submitted.
  const isOwnerOfSelected = isPlatform || selectedWs?.role === 'owner';
  const allowedScopes = isPlatform ? null : (selectedWs?.allowed_scopes ?? []);
  const ownerLocked = (value: string) => isOwnerOnlyScope(value) && !isOwnerOfSelected;
  const scopeAllowed = (value: string) =>
    !ownerLocked(value) && (!allowedScopes || allowedScopes.includes(value));
  const grantScopes = scopes.filter(scopeAllowed);
  const canApprove =
    phase === 'consent' &&
    grantScopes.length > 0 &&
    (isPlatform || (!!selectedWs && selectedWs.feature_mcp));

  const approve = async () => {
    if (!details || (!isPlatform && !selectedWs)) return;
    setPhase('submitting');
    try {
      await recordOAuthGrant(
        isPlatform
          ? { authorization_id: authorizationId, target: 'platform', scopes: grantScopes }
          : { authorization_id: authorizationId, conta_id: selectedWs!.id, scopes: grantScopes },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(
        msg.includes('feature_disabled')
          ? t('consent.featureDisabled')
          : msg.includes('owner_only_scope')
            ? ownerOnlyScopeError()
            : msg.includes('Insufficient permissions')
              ? t('consent.insufficientRole')
              : t('consent.recordFailed'),
      );
      setPhase('consent');
      return;
    }
    // Supabase mints the code and redirects the browser back to Claude.
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error) {
      toast.error(t('consent.approveFailed'));
      setPhase('consent');
      return;
    }
    setPhase('redirecting');
    if (data && 'redirect_url' in data) window.location.assign(data.redirect_url);
  };

  const deny = async () => {
    setPhase('submitting');
    const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) {
      toast.error(t('consent.denyFailed'));
      setPhase('consent');
      return;
    }
    setPhase('redirecting');
    if (data && 'redirect_url' in data) window.location.assign(data.redirect_url);
  };

  if (phase === 'loading' || phase === 'redirecting') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-bold">{t('consent.errorTitle')}</h1>
          <p className="text-muted-foreground">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const client = details!.client;
  const noEligible = workspaces.length === 0 && !platformAdmin;
  const noMcpWorkspace =
    !noEligible && workspaces.length > 0 && !workspaces.some((w) => w.feature_mcp);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-4">
      <div className="w-full max-w-md rounded-2xl border bg-[hsl(var(--card))] p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          {client.logo_uri ? (
            <img
              src={client.logo_uri}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] font-bold">
              {(client.name || 'C').charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">
              {t('consent.connectTitle', { name: client.name || t('consent.defaultAppLower') })}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {t('consent.redirectsTo', { host: hostOf(details!.redirect_uri) })}
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {client.name || t('consent.defaultAppUpper')}
          </span>{' '}
          {isPlatform ? t('consent.requestPlatform') : t('consent.requestWorkspace')}
        </p>

        {noEligible ? (
          <p className="mb-5 rounded-lg bg-[hsl(var(--muted))] p-3 text-sm text-muted-foreground">
            {t('consent.noEligible')}
          </p>
        ) : (
          <>
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('consent.workspace')}
              </p>
              <div className="space-y-2">
                {platformAdmin && (
                  <button
                    type="button"
                    onClick={() => selectWorkspace(PLATFORM)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition hover:bg-[hsl(var(--accent))] ${
                      isPlatform
                        ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]'
                        : 'border-[hsl(var(--border))]'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {t('consent.platformName')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t('consent.platformHelp')}
                      </span>
                    </span>
                  </button>
                )}
                {workspaces.map((w) => {
                  const isSel = w.id === selected;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={!w.feature_mcp}
                      onClick={() => selectWorkspace(w.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition ${
                        isSel
                          ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]'
                          : 'border-[hsl(var(--border))]'
                      } ${w.feature_mcp ? 'hover:bg-[hsl(var(--accent))]' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{w.name}</span>
                        <span className="block text-xs capitalize text-muted-foreground">
                          {w.role}
                        </span>
                      </span>
                      {!w.feature_mcp && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('consent.planWithoutMcp')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {noMcpWorkspace && (
                <p className="mt-2 text-xs text-muted-foreground">{t('consent.noMcpWorkspace')}</p>
              )}
            </div>

            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('consent.permissions')}
              </p>
              <div className="space-y-2">
                {scopeOptions.map((s) => {
                  const locked = ownerLocked(s.value);
                  const allowed = scopeAllowed(s.value);
                  return (
                    <div key={s.value}>
                      <label
                        className={`flex items-center gap-2 text-sm ${allowed ? '' : 'text-muted-foreground'}`}
                      >
                        <Checkbox
                          checked={allowed && scopes.includes(s.value)}
                          disabled={!allowed}
                          onCheckedChange={(c) => toggleScope(s.value, c === true)}
                        />
                        {isPlatform ? adminScopeLabel(s.value) : scopeLabel(s.value)}
                      </label>
                      {locked && (
                        <p className="ml-6 text-xs text-muted-foreground">{ownerOnlyHelp()}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {allowedScopes &&
                scopeOptions.some(
                  (o) => !isOwnerOnlyScope(o.value) && !allowedScopes.includes(o.value),
                ) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('consent.disabledScopesNote')}
                  </p>
                )}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={deny}
            disabled={phase === 'submitting'}
          >
            {t('consent.deny')}
          </Button>
          <Button className="flex-1" onClick={approve} disabled={!canApprove}>
            {phase === 'submitting' ? <Spinner size="sm" /> : t('consent.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
}
