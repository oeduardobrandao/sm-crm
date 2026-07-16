import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';
import { describeSignInError } from './login-error';

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
        await supabase.auth.signOut();
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
      <div className="w-full max-w-[400px] bg-white rounded-3xl p-10 shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto" />
          <p className="text-sm text-[#4b5563] mt-2 uppercase tracking-widest font-medium">admin</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] uppercase tracking-wider mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm font-sf text-[#12151a] focus:outline-none focus:border-[#eab308] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#374151] uppercase tracking-wider mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm font-sf text-[#12151a] focus:outline-none focus:border-[#eab308] transition-colors"
            />
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
