import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClienteFoto } from '../ClienteFoto';

const fallback = <span data-testid="initials">AB</span>;

describe('ClienteFoto', () => {
  it('shows the first photo when there is one', () => {
    const { container } = render(
      <ClienteFoto
        srcs={[null, 'https://x.test/ig.jpg', 'https://x.test/up.jpg']}
        fallback={fallback}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x.test/ig.jpg');
    expect(screen.queryByTestId('initials')).toBeNull();
  });

  it('falls through to the next photo, then to the initials, as each fails to load', () => {
    const { container } = render(
      <ClienteFoto srcs={['https://x.test/ig.jpg', 'https://x.test/up.jpg']} fallback={fallback} />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x.test/up.jpg');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('initials')).toBeInTheDocument();
  });

  it('shows the initials when there is no photo', () => {
    render(<ClienteFoto srcs={[undefined, null]} fallback={fallback} />);
    expect(screen.getByTestId('initials')).toBeInTheDocument();
  });
});
