import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TarefaHistoryList } from '../components/TarefaHistoryList';
import type { TarefaTimelineNode } from '../tarefaTimeline';

const nodes: TarefaTimelineNode[] = [
  {
    key: '2',
    tipo: 'status',
    text: 'Ana mudou o status de A fazer para Concluída',
    actorLabel: 'Ana',
    at: '2026-10-28T15:00:00Z',
    tone: 'success',
  },
  {
    key: '1',
    tipo: 'criada',
    text: 'Ana criou a tarefa',
    actorLabel: 'Ana',
    at: '2026-10-28T12:00:00Z',
    tone: 'primary',
  },
];

describe('TarefaHistoryList', () => {
  it('list renders footnote and one item per node', () => {
    const { container } = render(<TarefaHistoryList nodes={nodes} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Ana mudou o status de A fazer para Concluída')).toBeInTheDocument();
    expect(screen.getByText('Ana criou a tarefa')).toBeInTheDocument();
    expect(screen.getByText('Histórico registrado a partir de 28/10/2026.')).toBeInTheDocument();
    // Tones map onto the existing history-step classes (app.css), never new ones.
    expect(container.querySelector('.history-step-icon--ok')).not.toBeNull();
    expect(container.querySelector('.history-step-icon--approved')).not.toBeNull();
    // Only the last node has no connecting line.
    expect(container.querySelectorAll('.history-step-line')).toHaveLength(1);
  });

  it('shows the absolute date on hover', () => {
    render(<TarefaHistoryList nodes={nodes.slice(0, 1)} />);
    const time = screen.getByText((_, el) => el?.tagName === 'TIME');
    expect(time.getAttribute('title')).toMatch(/2026/);
    expect(time.getAttribute('dateTime')).toBe('2026-10-28T15:00:00Z');
  });

  it('renders an empty line and still the footnote with no nodes', () => {
    render(<TarefaHistoryList nodes={[]} />);
    expect(screen.getByText('Sem histórico.')).toBeInTheDocument();
    expect(screen.getByText('Histórico registrado a partir de 28/10/2026.')).toBeInTheDocument();
  });
});
