import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { avatarColorClass } from '@/lib/avatarColor';
import { PessoaAvatar } from '../PessoaAvatar';

describe('PessoaAvatar', () => {
  it('shows initials without photo', () => {
    const { container } = render(<PessoaAvatar nome="Ana Lima" seed={7} />);
    const el = screen.getByText('AL');
    expect(el).toHaveClass('avatar', avatarColorClass(7));
    expect(el).toHaveAttribute('aria-hidden');
    expect(container.querySelector('img')).toBeNull();
  });

  it('seeds the color by name when no seed is given', () => {
    render(<PessoaAvatar nome="Ana Lima" fotoUrl={null} />);
    expect(screen.getByText('AL')).toHaveClass(avatarColorClass('Ana Lima'));
  });

  it('shows the photo', () => {
    const { container } = render(
      <PessoaAvatar nome="Ana Lima" fotoUrl="https://x/a.jpg" className="extra" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://x/a.jpg');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('avatar', 'avatar--photo', 'extra');
    expect(screen.queryByText('AL')).toBeNull();
  });

  it('uses the given alt text', () => {
    render(<PessoaAvatar nome="Ana Lima" fotoUrl="https://x/a.jpg" alt="Ana Lima" />);
    expect(screen.getByRole('img', { name: 'Ana Lima' })).toBeInTheDocument();
  });

  it('applies the size to the photo and the initials', () => {
    const { container, rerender } = render(
      <PessoaAvatar nome="Ana Lima" fotoUrl="https://x/a.jpg" size={40} />,
    );
    const img = container.querySelector('img')!;
    expect(img.style.width).toBe('40px');
    expect(img.style.height).toBe('40px');

    rerender(<PessoaAvatar nome="Ana Lima" size={40} />);
    const el = screen.getByText('AL');
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('40px');
    expect(el.style.fontSize).toBe('16px');
  });

  it('falls back on error', () => {
    const { container } = render(<PessoaAvatar nome="Ana Lima" fotoUrl="https://x/broken.jpg" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('resets the error when fotoUrl changes', () => {
    const { container, rerender } = render(
      <PessoaAvatar nome="Ana Lima" fotoUrl="https://x/broken.jpg" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<PessoaAvatar nome="Ana Lima" fotoUrl="https://x/nova.jpg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/nova.jpg');
  });
});
