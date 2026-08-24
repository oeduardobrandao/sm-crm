import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClientAvatar } from '../ClientAvatar';

describe('ClientAvatar', () => {
  it('renders the photo when photoUrl is provided', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl="https://cdn.mesaas.com/foto.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.mesaas.com/foto.png');
  });

  it('falls back to the initial when photoUrl is null', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('falls back to the initial when the image fails to load', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl="https://cdn.mesaas.com/broken.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('keeps the existing 11px fallback size at the default (28px) size', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} />);
    expect(screen.getByText('C')).toHaveStyle({ fontSize: '11px' });
  });

  it('scales the fallback font size up for a larger avatar', () => {
    render(<ClientAvatar name="Clínica Aurora" photoUrl={null} size={128} />);
    expect(screen.getByText('C')).toHaveStyle({ fontSize: '51px' });
  });
});
