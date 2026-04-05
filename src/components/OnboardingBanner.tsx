// src/components/OnboardingBanner.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Cliente, Lead, Membro, Workflow } from '../store';
import type { PortfolioAccount } from '../services/analytics';

interface OnboardingBannerProps {
  clientes: Cliente[];
  leads: Lead[];
  membros: Membro[];
  portfolioAccounts: PortfolioAccount[];
  workflows: Workflow[];
}

export function OnboardingBanner({ clientes, leads, membros, portfolioAccounts, workflows }: OnboardingBannerProps) {
  const { profile } = useAuth();
  const storageKey = `onboarding_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(storageKey) === 'true'
  );

  const steps = [
    { label: 'Conta criada', done: true, to: null },
    { label: 'Adicionar primeiro cliente', done: clientes.length > 0, to: '/clientes' },
    { label: 'Criar primeiro lead', done: leads.length > 0, to: '/leads' },
    { label: 'Adicionar membro da equipe', done: membros.length > 0, to: '/equipe' },
    { label: 'Conectar conta do Instagram', done: portfolioAccounts.length > 0, to: '/analytics' },
    { label: 'Criar fluxo de entrega', done: workflows.length > 0, to: '/entregas' },
  ];

  const completedCount = steps.filter(s => s.done).length;

  useEffect(() => {
    if (completedCount === steps.length) {
      localStorage.setItem(storageKey, 'true');
      setDismissed(true);
    }
  }, [completedCount, steps.length, storageKey]);

  function handleDismiss() {
    localStorage.setItem(storageKey, 'true');
    setDismissed(true);
  }

  if (!profile) return null;
  if (dismissed) return null;

  const firstIncompleteIndex = steps.findIndex(s => !s.done);

  const titles: Record<number, { text: string; emoji: string }> = {
    0: { text: 'Bem-vindo ao CRM Fluxo!', emoji: '👋' },
    1: { text: 'Bem-vindo ao CRM Fluxo!', emoji: '👋' },
    2: { text: 'Você está indo bem!', emoji: '🎯' },
    3: { text: 'Você está indo bem!', emoji: '🎯' },
    4: { text: 'Quase lá!', emoji: '🎯' },
    5: { text: 'Quase lá!', emoji: '🎯' },
  };
  const { text: titleText, emoji } = titles[completedCount] ?? { text: 'Bem-vindo!', emoji: '👋' };
  const progressPct = (completedCount / steps.length) * 100;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e1e3f 0%, #2d1b69 100%)',
      borderBottom: '1px solid var(--accent, #6366f1)',
      padding: '20px 24px',
      position: 'relative',
      marginBottom: '1.5rem',
      borderRadius: 'var(--radius, 8px)',
    }}>
      <button
        onClick={handleDismiss}
        aria-label="Fechar"
        style={{
          position: 'absolute', top: 12, right: 12,
          background: 'transparent', border: 'none',
          color: 'var(--text-muted)', fontSize: '1.1rem',
          cursor: 'pointer', lineHeight: 1,
        }}
      >✕</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            <span aria-hidden="true">{emoji}</span> {titleText}
          </div>
          <div style={{ color: '#a5b4fc', fontSize: '0.82rem', marginBottom: 14 }}>
            Complete estes passos para configurar sua conta
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {steps.map((step, i) => {
              const isNext = i === firstIncompleteIndex;
              const content = (
                <>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', flexShrink: 0,
                    background: step.done ? 'var(--success, #22c55e)' : 'transparent',
                    border: step.done ? 'none' : `2px solid ${isNext ? 'var(--accent, #6366f1)' : '#555'}`,
                    color: step.done ? '#000' : (isNext ? 'var(--accent, #6366f1)' : '#555'),
                  }}>
                    {step.done ? '✓' : i + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem' }}>{step.label}</span>
                </>
              );

              const pillStyle: React.CSSProperties = {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', borderRadius: 6,
                textDecoration: 'none',
                color: step.done ? 'var(--success, #22c55e)' : (isNext ? '#fff' : '#888'),
                background: step.done
                  ? 'rgba(34,197,94,0.1)'
                  : (isNext ? 'rgba(99,102,241,0.2)' : 'transparent'),
                border: step.done
                  ? '1px solid rgba(34,197,94,0.2)'
                  : (isNext ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent'),
              };

              if (step.to) {
                return (
                  <Link key={step.label} to={step.to} style={pillStyle}>
                    {content}
                  </Link>
                );
              }
              return (
                <div key={step.label} style={pillStyle}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div aria-hidden="true" style={{ fontSize: '2rem', lineHeight: 1 }}>{emoji}</div>
          <div style={{ color: '#a5b4fc', fontSize: '0.75rem', marginTop: 4 }}>
            {completedCount} de {steps.length}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
        <div style={{
          height: 3,
          width: `${progressPct}%`,
          background: 'linear-gradient(90deg, #6366f1, #a5b4fc)',
          borderRadius: 2,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
}
