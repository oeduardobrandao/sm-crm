import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExampleBoard } from '../ExampleBoard';

describe('ExampleBoard', () => {
  it('renders the example card, approval column and tour anchors', () => {
    const { container } = render(<ExampleBoard onDismiss={() => {}} />);
    expect(screen.getByText('Posts de Agosto')).toBeTruthy();
    expect(screen.getByText('Exemplo')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-card"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-deadline"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-posts"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-col-aprovacao"]')).toBeTruthy();
  });

  it('dismiss control fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(<ExampleBoard onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Ocultar exemplo'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
