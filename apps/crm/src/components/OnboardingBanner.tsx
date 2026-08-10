// src/components/OnboardingBanner.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Target, Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useEntitlements } from '../hooks/useEntitlements';
import type { Cliente, Lead, Membro, Workflow } from '../store';
import type { PortfolioAccount } from '../services/analytics';

interface OnboardingBannerProps {
  clientes: Cliente[];
  leads: Lead[];
  membros: Membro[];
  portfolioAccounts: PortfolioAccount[];
  workflows: Workflow[];
}

export function OnboardingBanner({
  clientes,
  leads,
  membros,
  portfolioAccounts,
  workflows,
}: OnboardingBannerProps) {
  const { profile } = useAuth();
  const storageKey = `onboarding_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === 'true');

  const { hasFeature } = useEntitlements();

  // Each step carries the flag its destination is gated behind. Without this the checklist offers
  // Free users steps whose routes are nav-hidden and paywalled: the list can never reach 100%,
  // so it never auto-dismisses, and every click lands on an upgrade wall.
  // hasFeature is fail-open while entitlements load, matching the rest of the app.
  const allSteps = [
    { label: 'Conta criada', done: true, to: null, feature: null },
    {
      label: 'Adicionar primeiro cliente',
      done: clientes.length > 0,
      to: '/clientes',
      feature: null,
    },
    {
      label: 'Criar primeiro lead',
      done: leads.length > 0,
      to: '/leads',
      feature: 'feature_leads',
    },
    { label: 'Adicionar membro da equipe', done: membros.length > 0, to: '/equipe', feature: null },
    {
      label: 'Conectar conta do Instagram',
      done: portfolioAccounts.length > 0,
      to: '/analytics',
      feature: 'feature_analytics_reports',
    },
    { label: 'Criar fluxo de entrega', done: workflows.length > 0, to: '/entregas', feature: null },
  ];

  const steps = allSteps.filter((s) => s.feature === null || hasFeature(s.feature));

  const completedCount = steps.filter((s) => s.done).length;

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

  const firstIncompleteIndex = steps.findIndex((s) => !s.done);

  const titles: Record<number, string> = {
    0: 'Bem-vindo ao Mesaas!',
    1: 'Bem-vindo ao Mesaas!',
    2: 'Você está indo bem!',
    3: 'Você está indo bem!',
    4: 'Quase lá!',
    5: 'Quase lá!',
  };
  const titleText = titles[completedCount] ?? 'Bem-vindo!';
  const progressPct = (completedCount / steps.length) * 100;

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        padding: '20px 24px',
        marginBottom: '1.5rem',
        borderRadius: 'var(--radius, 12px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div
            className="badge-primary"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--badge-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Target size={16} color="var(--badge-fg)" aria-hidden="true" />
          </div>

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '0.9375rem',
                fontWeight: 600,
                color: 'var(--text-main)',
                marginBottom: 2,
              }}
            >
              {titleText}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: 14 }}>
              Complete estes passos para configurar sua conta
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {steps.map((step, i) => {
                const isNext = i === firstIncompleteIndex;
                const content = (
                  <>
                    {step.done ? (
                      <span
                        className="badge-success"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: 'var(--badge-solid-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Check size={12} color="#fff" aria-hidden="true" />
                      </span>
                    ) : (
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          flexShrink: 0,
                          background: isNext ? 'transparent' : 'var(--surface-2)',
                          border: isNext ? '2px solid var(--badge-fg)' : 'none',
                          color: isNext ? 'var(--badge-fg)' : 'var(--text-light)',
                        }}
                      >
                        {i + 1}
                      </span>
                    )}
                    <span style={{ fontSize: '0.8125rem' }}>{step.label}</span>
                  </>
                );

                const pillStyle: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 9px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: step.done
                    ? 'var(--badge-fg)'
                    : isNext
                      ? 'var(--text-main)'
                      : 'var(--text-muted)',
                  fontWeight: isNext ? 600 : 400,
                  background: step.done || isNext ? 'var(--badge-bg)' : 'var(--surface-1)',
                  border:
                    step.done || isNext ? '1px solid var(--badge-border)' : '1px solid transparent',
                };

                const stepClassName = step.done
                  ? 'badge-success'
                  : isNext
                    ? 'badge-primary'
                    : undefined;

                if (step.to) {
                  return (
                    <Link key={step.label} to={step.to} className={stepClassName} style={pillStyle}>
                      {content}
                    </Link>
                  );
                }
                return (
                  <div key={step.label} className={stepClassName} style={pillStyle}>
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {completedCount} de {steps.length}
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Fechar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
              display: 'flex',
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
        <div
          style={{
            height: 4,
            width: `${progressPct}%`,
            background: 'var(--primary-color)',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}
