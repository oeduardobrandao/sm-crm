import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import {
  listEligibleWorkspaces,
  recordOAuthGrant,
  type EligibleWorkspace,
} from '@/services/mcp-oauth';
import { SCOPE_OPTIONS, AGENT_PRESET } from '@/lib/mcp-scopes';
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

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

export default function ConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') || params.get('authorizationId') || '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [workspaces, setWorkspaces] = useState<EligibleWorkspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(AGENT_PRESET);

  useEffect(() => {
    let cancelled = false;
    if (!authorizationId) {
      setErrorMsg('Pedido de autorização inválido ou expirado.');
      setPhase('error');
      return;
    }
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setErrorMsg(
          'Não foi possível carregar o pedido de autorização. Tente reconectar pelo Claude.',
        );
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
        const ws = await listEligibleWorkspaces();
        if (cancelled) return;
        setWorkspaces(ws);
        // Preselect the first MCP-enabled workspace, else the first one.
        setSelected((ws.find((w) => w.feature_mcp) ?? ws[0])?.id ?? null);
      } catch {
        if (cancelled) return;
        setWorkspaces([]);
      }
      setPhase('consent');
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  const toggleScope = (value: string, checked: boolean) =>
    setScopes((prev) =>
      checked ? [...new Set([...prev, value])] : prev.filter((s) => s !== value),
    );

  const selectedWs = workspaces.find((w) => w.id === selected) ?? null;
  const canApprove =
    phase === 'consent' && !!selectedWs && selectedWs.feature_mcp && scopes.length > 0;

  const approve = async () => {
    if (!details || !selectedWs) return;
    setPhase('submitting');
    try {
      await recordOAuthGrant({
        authorization_id: authorizationId,
        conta_id: selectedWs.id,
        scopes,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(
        msg.includes('feature_disabled')
          ? 'O plano deste workspace não inclui a integração MCP.'
          : 'Não foi possível registrar a autorização.',
      );
      setPhase('consent');
      return;
    }
    // Supabase mints the code and redirects the browser back to Claude.
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error) {
      toast.error('Falha ao concluir a autorização.');
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
      toast.error('Não foi possível recusar o pedido.');
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
          <h1 className="mb-2 text-xl font-bold">Algo deu errado</h1>
          <p className="text-muted-foreground">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const client = details!.client;
  const noEligible = workspaces.length === 0;
  const noMcpWorkspace = !noEligible && !workspaces.some((w) => w.feature_mcp);

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
              Conectar {client.name || 'aplicativo'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Redireciona para {hostOf(details!.redirect_uri)}
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{client.name || 'O aplicativo'}</span> está
          solicitando acesso de <strong>leitura</strong> aos dados de um workspace no Mesaas.
          Escolha o workspace e as permissões abaixo.
        </p>

        {noEligible ? (
          <p className="mb-5 rounded-lg bg-[hsl(var(--muted))] p-3 text-sm text-muted-foreground">
            Você precisa ser <strong>dono</strong> ou <strong>administrador</strong> de um workspace
            para conectar o Claude.
          </p>
        ) : (
          <>
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspace
              </p>
              <div className="space-y-2">
                {workspaces.map((w) => {
                  const isSel = w.id === selected;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={!w.feature_mcp}
                      onClick={() => setSelected(w.id)}
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
                          Plano sem MCP
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {noMcpWorkspace && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhum dos seus workspaces inclui a integração MCP no plano atual.
                </p>
              )}
            </div>

            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Permissões
              </p>
              <div className="space-y-2">
                {SCOPE_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={scopes.includes(s.value)}
                      onCheckedChange={(c) => toggleScope(s.value, c === true)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
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
            Negar
          </Button>
          <Button className="flex-1" onClick={approve} disabled={!canApprove}>
            {phase === 'submitting' ? <Spinner size="sm" /> : 'Autorizar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
