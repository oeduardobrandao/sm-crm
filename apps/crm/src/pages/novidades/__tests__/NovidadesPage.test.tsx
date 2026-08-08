import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NovidadesPage from '../NovidadesPage';
import type { ChangelogRelease } from '@/content/changelog.schema';

const releases: ChangelogRelease[] = [
  {
    date: '2026-06-03',
    summary: 'Resumo da semana.',
    items: [
      { type: 'feature', area: 'Entregas', title: 'Recurso A', description: 'Descrição A.', pr: 1 },
      { type: 'fix', area: 'Analytics', title: 'Correção B', description: 'Descrição B.', pr: 2 },
    ],
  },
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

  it('renders an item image and link when present, and omits them otherwise', () => {
    const withExtras: ChangelogRelease[] = [
      {
        date: '2026-08-08',
        items: [
          {
            type: 'feature',
            area: 'Entregas',
            title: 'Com imagem',
            description: 'D.',
            pr: 3,
            image: '/novidades/pr-3.png',
            link: { href: '/entregas', label: 'Abrir Entregas' },
          },
          { type: 'fix', area: 'Hub', title: 'Sem extras', description: 'D.', pr: 4 },
        ],
      },
    ];
    render(<NovidadesPage releases={withExtras} />);
    const img = screen.getByRole('img', { name: 'Com imagem' });
    expect(img).toHaveAttribute('src', '/novidades/pr-3.png');
    const link = screen.getByRole('link', { name: /Abrir Entregas/ });
    expect(link).toHaveAttribute('href', '/entregas');
    expect(screen.queryAllByRole('img')).toHaveLength(1);
  });
});
