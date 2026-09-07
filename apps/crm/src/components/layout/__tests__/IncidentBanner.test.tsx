import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { IncidentBanner } from '../IncidentBanner';

describe('IncidentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing now that INCIDENT_BANNER_ACTIVE is false', () => {
    render(<IncidentBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
