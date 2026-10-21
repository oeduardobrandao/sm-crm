import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KbViewStats } from '../KbViewStats';

const stats = { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64, completed: 31 };

describe('KbViewStats', () => {
  it('shows 30-day views and people, then the all-time total', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} />);
    expect(screen.getByText('48 visualizações · 12 pessoas')).toBeInTheDocument();
    expect(screen.getByText('Total: 210 · 64 pessoas')).toBeInTheDocument();
    expect(screen.queryByText(/concluíram/)).not.toBeInTheDocument();
  });

  it('adds completions for videos', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} showCompleted />);
    expect(screen.getByText('Total: 210 · 64 pessoas · 31 concluíram')).toBeInTheDocument();
  });

  it('uses singulars', () => {
    render(
      <KbViewStats
        stats={{ views_30d: 1, users_30d: 1, views_total: 1, users_total: 1, completed: 1 }}
        loading={false}
        failed={false}
        showCompleted
      />,
    );
    expect(screen.getByText('1 visualização · 1 pessoa')).toBeInTheDocument();
    expect(screen.getByText('Total: 1 · 1 pessoa · 1 concluiu')).toBeInTheDocument();
  });

  it('formats thousands in pt-BR', () => {
    render(
      <KbViewStats
        stats={{ views_30d: 1200, users_30d: 2, views_total: 15000, users_total: 1500 }}
        loading={false}
        failed={false}
      />,
    );
    expect(screen.getByText('1.200 visualizações · 2 pessoas')).toBeInTheDocument();
    expect(screen.getByText('Total: 15.000 · 1.500 pessoas')).toBeInTheDocument();
  });

  it('shows the zero state when there are no stats', () => {
    render(<KbViewStats stats={undefined} loading={false} failed={false} />);
    expect(screen.getByText('Sem visualizações')).toBeInTheDocument();
  });

  it('renders nothing when the stats query failed', () => {
    const { container } = render(<KbViewStats stats={undefined} loading={false} failed />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the 30-day line for assistive tech', () => {
    render(<KbViewStats stats={stats} loading={false} failed={false} />);
    expect(screen.getByText('Últimos 30 dias:')).toHaveClass('sr-only');
  });
});
