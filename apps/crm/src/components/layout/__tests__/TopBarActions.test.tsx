import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_PREFERENCES_EVENT } from '@/lib/consent';
import { seedConsent } from '../../../test/consent';

vi.mock('../NotificationBell', () => ({ default: () => null }));

import TopBarActions from '../TopBarActions';

describe('TopBarActions chat button', () => {
  beforeEach(() => {
    localStorage.clear();
    window.$crisp = [];
  });

  it('opens the consent dialog instead of a dead click when support consent is missing', () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    render(<TopBarActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(window.$crisp).not.toContainEqual(['do', 'chat:open']);
  });

  it('opens the Crisp chat when support consent is granted', () => {
    seedConsent({ support: true });
    render(<TopBarActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(window.$crisp).toContainEqual(['do', 'chat:open']);
  });
});
