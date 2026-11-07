import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialBadge } from '../MaterialBadge';

describe('MaterialBadge', () => {
  it('renders the waiting copy', () => {
    render(<MaterialBadge kind="aguardando" done={1} total={3} />);
    expect(screen.getByText('Material · 1 de 3 itens')).toBeInTheDocument();
  });
  it('renders the received copy', () => {
    render(<MaterialBadge kind="recebido" done={3} total={3} />);
    expect(screen.getByText('Material recebido · 3 de 3 itens')).toBeInTheDocument();
  });
  it('keeps X de N for a partial close', () => {
    render(<MaterialBadge kind="recebido" done={2} total={3} />);
    expect(screen.getByText('Material recebido · 2 de 3 itens')).toBeInTheDocument();
  });
  it('uses the singular for one item', () => {
    render(<MaterialBadge kind="aguardando" done={0} total={1} />);
    expect(screen.getByText('Material · 0 de 1 item')).toBeInTheDocument();
  });
});
