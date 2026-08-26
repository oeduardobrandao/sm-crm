import React, { useEffect } from 'react';
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

function PageWithSiblingEffect({ onOpen }: { onOpen: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  useOpenParam('novo', onOpen);

  // Sibling effect that mutates an unrelated param (simulating another feature on the same page)
  useEffect(() => {
    const initialRenderRef = React.useRef(true);
    if (!initialRenderRef.current) return;
    initialRenderRef.current = false;

    // Mutate a different param on initial render
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('outro', 'x');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return (
    <div>
      <span data-testid="qs">{searchParams.toString()}</span>
      <button onClick={() => navigate('/page?novo=1&filtro=ativos')}>self-nav</button>
    </div>
  );
}

function PageWithSiblingEffect_Navigated({ onOpen }: { onOpen: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  useOpenParam('novo', onOpen);
  const navigate = useNavigate();

  // Sibling effect that mutates an unrelated param independently
  // This simulates a real-world scenario like EntregasPage that also mutates search params
  useEffect(() => {
    // Effect that runs on component mount and mutates a different param
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('outro', 'x');
        return next;
      },
      { replace: true },
    );
  }, []); // Empty deps to only run once

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

  it('regression: onOpen dispara exatamente uma vez mesmo com sibling effect mutando outro param', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page?novo=1&filtro=ativos']}>
        <PageWithSiblingEffect_Navigated onOpen={onOpen} />
      </MemoryRouter>,
    );
    // The key assertion: onOpen should be called exactly once, even though setSearchParams
    // identity changes when the sibling effect runs
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    // Verify that the query params were processed (novo should be removed when onOpen was called)
    const qs = screen.getByTestId('qs').textContent || '';
    expect(qs).toContain('filtro=ativos');
    expect(qs).toContain('outro=x');
  });
});
