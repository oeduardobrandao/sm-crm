import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NovidadesPage from '../NovidadesPage';
import type { ChangelogRelease } from '@/content/changelog.schema';

const releases: ChangelogRelease[] = [
  { date: '2026-06-03', summary: 'Resumo da semana.', items: [
    { type: 'feature', area: 'Entregas', title: 'Recurso A', description: 'Descrição A.', pr: 1 },
    { type: 'fix', area: 'Analytics', title: 'Correção B', description: 'Descrição B.', pr: 2 },
  ] },
];

describe('NovidadesPage', () => {
  it('renders titles, descriptions, and type badges', () => {
    render(<NovidadesPage releases={releases} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Novidades' })).toBeInTheDocument();
    expect(screen.getByText('Recurso A')).toBeInTheDocument();
    expect(screen.getByText('Descrição B.')).toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByText('Correção')).toBeInTheDocument();
  });

  it('shows an empty state when there are no releases', () => {
    render(<NovidadesPage releases={[]} />);
    expect(screen.getByText(/Em breve/)).toBeInTheDocument();
  });
});
