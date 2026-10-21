import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../../HubContext';
import { StatusTag } from '../StatusTag';

describe('StatusTag Pauta', () => {
  it('uses the status token on a card background', () => {
    render(
      <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
        <StatusTag status="enviado_cliente" />
      </HubContext.Provider>,
    );
    const el = screen
      .getByText('Aguardando aprovação')
      .closest('span[data-hub-status]') as HTMLElement;
    expect(el.dataset.hubStatus).toBe('wait');
    expect(el.style.color).toBe('var(--hub-st-wait-fg)');
    expect(el.style.background).toBe('var(--hub-card)');
    expect(el.style.borderRadius).toBe('var(--hub-r-chip)');
  });
  it('unknown status reads done', () => {
    render(
      <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
        <StatusTag status="xyz" />
      </HubContext.Provider>,
    );
    expect((document.querySelector('[data-hub-status]') as HTMLElement).dataset.hubStatus).toBe(
      'done',
    );
  });
});
