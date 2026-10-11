import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sonnerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonnerProps.current = props;
    return null;
  },
}));

import { Toaster } from '../sonner';

describe('Toaster', () => {
  it('lifts toasts above the phone tab bar through --phone-toast-offset', () => {
    render(<Toaster />);
    // sonner uses mobileOffset under 600px and offset above it; phones reach 767px.
    expect(sonnerProps.current?.mobileOffset).toEqual({
      bottom: 'var(--phone-toast-offset, 16px)',
    });
    expect(sonnerProps.current?.offset).toEqual({ bottom: 'var(--phone-toast-offset, 24px)' });
  });

  it('lets callers override the offsets', () => {
    render(<Toaster mobileOffset={8} />);
    expect(sonnerProps.current?.mobileOffset).toBe(8);
    expect(sonnerProps.current?.theme).toBe('system');
  });
});
