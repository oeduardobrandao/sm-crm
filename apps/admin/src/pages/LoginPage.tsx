import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';
import { describeSignInError } from './login-error';
import { Button } from '../components/ui/button';
import { useIsPhone } from '../hooks/useIsPhone';
import { cn } from '../lib/utils';
import './login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        console.error('[admin-login] sign-in failed', {
          code: authError.code,
          status: authError.status,
          message: authError.message,
        });
        setError(describeSignInError(authError));
        setLoading(false);
        return;
      }

      const { is_admin } = await verifyAdmin();
      if (!is_admin) {
        // 'local' — undo only the sign-in we just performed in this browser. A global sign-out
        // would log a legitimate CRM user out everywhere (and drop their OAuth/MCP connector)
        // merely for landing on the admin login page.
        await supabase.auth.signOut({ scope: 'local' });
        setError('Acesso não autorizado.');
        setLoading(false);
        return;
      }

      navigate('/admin');
    } catch (err) {
      console.error('[admin-login] unexpected failure', err);
      setError('Erro ao fazer login. Tente novamente.');
      setLoading(false);
    }
  };

  const fieldRow = cn(
    'flex items-center gap-3 px-4 transition-colors focus-within:bg-foreground/[0.06] focus-within:ring-2 focus-within:ring-inset focus-within:ring-foreground/40',
    isPhone ? 'min-h-[52px] text-[17px]' : 'min-h-[48px] px-3.5 text-[15px]',
  );
  const fieldLabel = cn('shrink-0', isPhone ? 'w-16' : 'w-[60px]');
  const fieldInput =
    'min-w-0 flex-1 border-0 bg-transparent p-0 text-[length:inherit] text-foreground outline-none placeholder:text-muted-foreground';

  const header = (
    <div className={cn('flex flex-col items-center', isPhone ? 'gap-2.5' : 'mb-6 gap-2')}>
      <img
        src="/logo-black.svg"
        alt="Mesaas"
        className="admin-login-logo-black h-7 w-auto dark:hidden"
      />
      <img
        src="/logo-white.svg"
        alt=""
        aria-hidden="true"
        className="admin-login-logo-white hidden h-7 w-auto dark:block"
      />
      <h1
        className={cn('m-0 font-bold text-foreground', isPhone ? 'text-[28px]' : 'text-[26px]')}
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Mesaas Admin
      </h1>
      <p
        className={cn('m-0 text-center text-muted-foreground', isPhone ? 'text-[15px]' : 'text-sm')}
      >
        Acesso restrito à equipe da plataforma
      </p>
    </div>
  );

  const form = (
    <form onSubmit={handleSubmit} className={cn('flex flex-col', isPhone ? 'gap-3.5' : 'gap-3')}>
      <div
        className={cn(
          'overflow-hidden bg-card',
          isPhone ? 'rounded-2xl bg-card/90 backdrop-blur-xl' : 'rounded-[14px]',
        )}
      >
        <label htmlFor="admin-login-email" className={cn(fieldRow, 'border-b border-border/70')}>
          <span className={fieldLabel}>E-mail</span>
          <input
            id="admin-login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={fieldInput}
          />
        </label>
        <label htmlFor="admin-login-password" className={fieldRow}>
          <span className={fieldLabel}>Senha</span>
          <input
            id="admin-login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={fieldInput}
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className={cn(
            'admin-login-error m-0',
            isPhone ? 'mx-4 text-[13px]' : 'text-center text-sm',
          )}
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant="ink"
        disabled={loading}
        className={cn(
          'w-full',
          isPhone ? 'h-[52px] rounded-[14px] text-[17px]' : 'h-[46px] rounded-xl text-[15px]',
        )}
      >
        {loading ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );

  return (
    <div
      className={cn(
        'admin-login-light flex min-h-[100dvh] items-center justify-center',
        isPhone
          ? 'px-4 pb-[max(34px,env(safe-area-inset-bottom))] pt-[max(54px,env(safe-area-inset-top))]'
          : 'p-6',
      )}
    >
      {isPhone ? (
        <div className="flex w-full flex-col gap-7">
          {header}
          {form}
        </div>
      ) : (
        <div className="admin-login-card w-full max-w-[400px] rounded-[28px] border border-white/60 bg-card/75 px-8 pb-8 pt-9 text-card-foreground backdrop-blur-2xl">
          {header}
          {form}
        </div>
      )}
    </div>
  );
}
