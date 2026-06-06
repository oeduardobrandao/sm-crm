import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PostTimelineList } from '../PostTimelinePopover';
import type { TimelineNode } from '../postTimeline';

describe('PostTimelineList', () => {
  it('renders one row per node with label, actor, and comment', () => {
    const nodes: TimelineNode[] = [
      { key: 'created', kind: 'created', label: 'Criado', at: '2026-06-01T10:00:00Z', actorLabel: '—', comment: null, tone: 'neutral' },
      { key: 'e1', kind: 'status', label: 'Aprovado pelo cliente', at: '2026-06-03T12:00:00Z', actorLabel: 'Cliente', comment: 'Perfeito!', tone: 'approved' },
    ];
    render(<PostTimelineList nodes={nodes} />);
    expect(screen.getByText('Criado')).toBeInTheDocument();
    expect(screen.getByText('Aprovado pelo cliente')).toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Perfeito!')).toBeInTheDocument();
  });
});
