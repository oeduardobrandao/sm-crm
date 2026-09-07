import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';
import { describeSignInError } from './login-error';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export default function LoginPage() {
  const navigate = useNavigate();
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

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #eaf0dc 0%, #eab308 100%)' }}
    >
      <div className="w-full max-w-[400px] rounded-3xl bg-card p-10 text-card-foreground shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto dark:hidden" />
          <img
            src="/logo-white.svg"
            alt=""
            aria-hidden="true"
            className="hidden h-5 w-auto dark:block"
          />
          <p className="mt-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            admin
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-login-email" className="text-xs uppercase tracking-wider">
              E-mail
            </Label>
            <Input
              id="admin-login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-login-password" className="text-xs uppercase tracking-wider">
              Senha
            </Label>
            <Input
              id="admin-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
