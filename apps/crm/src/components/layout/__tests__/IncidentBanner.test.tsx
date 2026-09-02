import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { IncidentBanner } from '../IncidentBanner';

const STORAGE_KEY = 'incident-banner-dismissed:workspace-access-2026-09-02';

describe('IncidentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the incident warning', () => {
    render(<IncidentBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Instabilidade no acesso ao workspace');
  });

  it('dismisses and persists the dismissal', () => {
    render(<IncidentBanner />);
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('stays hidden when previously dismissed', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    render(<IncidentBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
