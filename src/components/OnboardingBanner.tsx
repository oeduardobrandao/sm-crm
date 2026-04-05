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

  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem(storageKey) === 'true';
  });

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

  if (dismissed) return null;

  return <div>placeholder</div>;
}
