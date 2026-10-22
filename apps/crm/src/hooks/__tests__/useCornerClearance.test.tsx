import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCornerClearance } from '../useCornerClearance';

function Bar() {
  const ref = useRef<HTMLDivElement>(null);
  useCornerClearance(ref);
  return <div ref={ref} data-testid="bar" />;
}

describe('useCornerClearance', () => {
  it('publishes the distance from the bar top to the viewport bottom, cleared on unmount', () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: window.innerHeight - 68.4 } as DOMRect);
    const { unmount } = render(<Bar />);
    expect(document.documentElement.style.getPropertyValue('--corner-clearance')).toBe('68px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--corner-clearance')).toBe('');
    rect.mockRestore();
  });
});
