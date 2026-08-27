import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'pt' } }),
}));

import AutomacoesChecklist from '../AutomacoesChecklist';

const base = {
  accountReady: false,
  hasAutomation: false,
  hasFirstDm: false,
  canCreate: true,
  onCreate: vi.fn(),
  onDismiss: vi.fn(),
};

function renderChecklist(overrides: Partial<typeof base> = {}) {
  return render(
    <MemoryRouter>
      <AutomacoesChecklist {...base} {...overrides} />
    </MemoryRouter>,
  );
}

describe('AutomacoesChecklist', () => {
  it('0/3: três passos pendentes, passo 1 é o atual', () => {
    renderChecklist();
    expect(screen.getByText('checklist.title')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-step-1').dataset.state).toBe('current');
    expect(screen.getByTestId('checklist-step-2').dataset.state).toBe('pending');
    expect(screen.getByTestId('checklist-step-3').dataset.state).toBe('pending');
  });

  it('1/3: passo 1 done, passo 2 atual com CTA que chama onCreate', () => {
    const onCreate = vi.fn();
    renderChecklist({ accountReady: true, onCreate });
    expect(screen.getByTestId('checklist-step-1').dataset.state).toBe('done');
    expect(screen.getByTestId('checklist-step-2').dataset.state).toBe('current');
    fireEvent.click(screen.getByRole('button', { name: 'checklist.step2Cta' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('sem entitlement (canCreate=false) o CTA do passo 2 não existe', () => {
    renderChecklist({ accountReady: true, canCreate: false });
    expect(screen.queryByRole('button', { name: 'checklist.step2Cta' })).not.toBeInTheDocument();
  });

  it('3/3: não renderiza nada', () => {
    const { container } = renderChecklist({
      accountReady: true,
      hasAutomation: true,
      hasFirstDm: true,
    });
    expect(container.firstChild).toBeNull();
  });

  it('dispensar chama onDismiss', () => {
    const onDismiss = vi.fn();
    renderChecklist({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'checklist.dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
