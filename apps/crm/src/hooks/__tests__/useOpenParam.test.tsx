import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useOpenParam } from '../useOpenParam';

function Page({ onOpen }: { onOpen: () => void }) {
  useOpenParam('novo', onOpen);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="qs">{searchParams.toString()}</span>
      <button onClick={() => navigate('/page?novo=1&filtro=ativos')}>self-nav</button>
    </div>
  );
}

describe('useOpenParam', () => {
  it('dispara no mount com o param presente e o remove preservando o resto', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page?novo=1&filtro=ativos']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('qs').textContent).toBe('filtro=ativos');
  });

  it('dispara de novo quando o param REAPARECE sem remontar a página', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('self-nav'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('qs').textContent).toBe('filtro=ativos');
  });

  it('não dispara sem o param', () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page?filtro=ativos']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
