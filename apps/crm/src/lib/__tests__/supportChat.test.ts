import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

describe('supportChat', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    window.$crisp = [];
  });

  it('opens the consent dialog focused on support when consent is missing (no dead click)', async () => {
    const { OPEN_PREFERENCES_EVENT } = await import('../consent');
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    const { openSupportChat } = await import('../supportChat');
    openSupportChat();
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ focus: 'support' });
    expect(window.$crisp).toEqual([]);
  });

  it('shows and opens the chat when support consent is granted', async () => {
    seedConsent({ support: true });
    const { openSupportChat } = await import('../supportChat');
    openSupportChat();
    expect(window.$crisp).toEqual([
      ['do', 'chat:show'],
      ['do', 'chat:open'],
    ]);
  });

  it('opens the chat once consent arrives after a blocked click, but not after the dialog was dismissed', async () => {
    const { openSupportChat, resumePendingSupportChat, clearPendingSupportChat } =
      await import('../supportChat');
    openSupportChat();
    seedConsent({ support: true });
    resumePendingSupportChat();
    expect(window.$crisp).toContainEqual(['do', 'chat:open']);

    window.$crisp = [];
    localStorage.clear();
    openSupportChat();
    clearPendingSupportChat();
    seedConsent({ support: true });
    resumePendingSupportChat();
    expect(window.$crisp).toEqual([]);
  });
});
