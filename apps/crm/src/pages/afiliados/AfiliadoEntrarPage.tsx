import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AffiliateApiError, exchangeAffiliateLogin } from '@/services/affiliates';
import AfiliadosLayout from './AfiliadosLayout';
import RequestLinkCard from './RequestLinkCard';
import { saveSession } from './session';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Lê o token do fragmento (#...) uma vez. O fragmento nunca vai ao servidor nem no Referer. */
function readLoginToken(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  return TOKEN_RE.test(raw) ? raw : null;
}

/**
 * /afiliados/entrar#<token>: destino do link mágico do e-mail. A troca pela sessão só acontece
 * no clique em "Entrar no painel", para que filtros de e-mail que abrem o link (e até rodam
 * JS) não gastem o token de uso único. Spec: 2026-10-10-afiliados-login-link-magico-design.md
 */
export default function AfiliadoEntrarPage() {
  const navigate = useNavigate();
  const [loginToken, setLoginToken] = useState<string | null>(readLoginToken);

  // Tira o token da barra de endereço (histórico, prints) assim que ele está em memória.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  const exchange = useMutation({
    mutationFn: (token: string) => exchangeAffiliateLogin(token),
    onSuccess: ({ session_token }) => {
      // Gasto: uma nova montagem nunca tenta trocar o mesmo token de novo.
      setLoginToken(null);
      const persisted = saveSession(session_token);
      navigate('/afiliados/painel', { replace: true, state: { storageBlocked: !persisted } });
    },
  });

  const expired =
    !loginToken || (exchange.error instanceof AffiliateApiError && exchange.error.status === 404);

  return (
    <AfiliadosLayout
      headerRight={<span className="text-sm text-muted-foreground">Painel do afiliado</span>}
    >
      {expired && !exchange.isPending ? (
        <RequestLinkCard
          title={loginToken ? 'Este link expirou ou já foi usado' : 'Entre no painel do afiliado'}
          body={
            loginToken
              ? 'Por segurança, cada link de acesso vale por 15 minutos e funciona uma vez. Informe seu e-mail para receber um novo.'
              : 'Informe o e-mail cadastrado no programa e enviaremos um link de acesso. Ele vale por 15 minutos e funciona uma vez.'
          }
        />
      ) : (
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8">
          <h1 className="mb-2 text-xl font-semibold">Entrar no painel do afiliado</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Este link é de uso único. Depois de entrar, este navegador fica conectado por 30 dias.
          </p>
          {exchange.isError && (
            <p className="mb-4 text-sm text-[var(--danger-text)]" role="alert">
              {exchange.error.message}
            </p>
          )}
          <Button
            className="w-full"
            onClick={() => loginToken && exchange.mutate(loginToken)}
            disabled={exchange.isPending || !loginToken}
          >
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            {exchange.isPending
              ? 'Entrando…'
              : exchange.isError
                ? 'Tentar novamente'
                : 'Entrar no painel'}
          </Button>
        </div>
      )}
    </AfiliadosLayout>
  );
}
