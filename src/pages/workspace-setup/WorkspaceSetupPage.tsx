import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export default function WorkspaceSetupPage() {
  const navigate = useNavigate();
  const { user, profile, refetchProfile } = useAuth();
  const [nome, setNome] = useState(profile?.nome ?? '');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !workspaceName.trim()) return;
    if (!user || !profile) return;

    setLoading(true);
    try {
      const wsId = profile.active_workspace_id || profile.conta_id;

      // Update workspace name
      const { error: wsErr } = await supabase
        .from('workspaces')
        .update({ name: workspaceName.trim() })
        .eq('id', wsId);
      if (wsErr) throw wsErr;

      // Update contas name
      await supabase
        .from('contas')
        .update({ nome: workspaceName.trim() })
        .eq('id', wsId);

      // Update profile name + empresa
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ nome: nome.trim(), empresa: workspaceName.trim() })
        .eq('id', user.id);
      if (profileErr) throw profileErr;

      await refetchProfile();

      setLoading(false);
      setDone(true);
      setTimeout(() => setProgressWidth(100), 100);
      setTimeout(() => navigate('/dashboard'), 2800);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      background: '#f5f3ee',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        width: '100%',
        maxWidth: 440,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
      }}>
        {/* Header */}
        <div style={{ background: '#1a3d2b', padding: '2rem 2rem 1.75rem', textAlign: 'center' }}>
          <img src="/logo-white.svg" alt="Mesaas" style={{ display: 'block', margin: '0 auto 1.5rem', height: 24, width: 'auto' }} />
          <div style={{
            width: 52, height: 52,
            background: '#f0a832',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
            margin: '0 auto 1rem',
          }}>
            🏢
          </div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: '0 0 0.35rem' }}>
            Configure seu workspace
          </h1>
          <p style={{ color: '#9dbfa9', fontSize: 14, margin: 0 }}>
            Quase lá! Diga como chamar você e sua empresa.
          </p>
        </div>

        {!done ? (
          <div style={{ padding: '2rem' }}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="setup-nome">Seu nome completo</Label>
                <Input
                  id="setup-nome"
                  placeholder="Ana dos Santos"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="setup-workspace">Nome da sua empresa ou agência</Label>
                <Input
                  id="setup-workspace"
                  placeholder="Agência Digital"
                  value={workspaceName}
                  onChange={e => setWorkspaceName(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !nome.trim() || !workspaceName.trim()}
                className="w-full"
                style={{ height: 46, background: '#1a3d2b', borderColor: '#1a3d2b', fontSize: 15, fontWeight: 600 }}
              >
                {loading && <Spinner size="sm" />}
                Entrar na plataforma
              </Button>
            </form>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 2rem 2.5rem' }}>
            <div style={{
              width: 60, height: 60,
              background: '#eaf3de',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="#3b6d11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a3d2b', margin: '0 0 0.5rem' }}>
              Tudo pronto, {nome.split(' ')[0]}!
            </h2>
            <p style={{ fontSize: 14, color: '#888780', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
              Bem-vindo ao <strong style={{ color: '#444441' }}>{workspaceName}</strong>. Redirecionando você agora...
            </p>
            <div style={{ width: '100%', height: 4, background: '#f1efe8', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: '#1a3d2b',
                width: `${progressWidth}%`,
                borderRadius: 4,
                transition: 'width 2.5s ease',
              }} />
            </div>
          </div>
        )}

        <div style={{ padding: '1rem 2rem', background: '#f8f7f3', borderTop: '1px solid #ece9e2', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#888780', margin: 0 }}>
            Você pode alterar essas informações depois em Configurações.
          </p>
        </div>
      </div>
    </div>
  );
}
