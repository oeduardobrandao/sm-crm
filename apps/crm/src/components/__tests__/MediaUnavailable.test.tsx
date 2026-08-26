import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaUnavailable } from '../MediaUnavailable';

describe('MediaUnavailable', () => {
  it('shows the label in full size', () => {
    render(<MediaUnavailable />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('hides the label in compact size', () => {
    render(<MediaUnavailable size="compact" />);
    expect(screen.queryByText('Mídia indisponível')).not.toBeInTheDocument();
  });
});
