import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getTikTokCreatorInfoMock } = vi.hoisted(() => ({ getTikTokCreatorInfoMock: vi.fn() }));

vi.mock('../../../../services/tiktok', () => ({
  getTikTokCreatorInfo: (...args: unknown[]) => getTikTokCreatorInfoMock(...args),
}));

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement —
// mocked the same way WorkflowModals.test.tsx does, so onValueChange/placeholder
// behavior is still exercised without fighting jsdom.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

// Radix Checkbox/Switch — mocked to plain native inputs (checked/onCheckedChange), same
// convention as WorkflowModals.test.tsx's Checkbox mock, extended to Switch.
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    id,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      type="checkbox"
      role="checkbox"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { TikTokSettingsPanel } from '../TikTokSettingsPanel';
import type { WorkflowPost } from '../../../../store';

const basePost: Pick<
  WorkflowPost,
  'id' | 'tipo' | 'tiktok_settings' | 'tiktok_caption' | 'tiktok_title'
> = {
  id: 42,
  tipo: 'reels',
  tiktok_settings: null,
  tiktok_caption: null,
  tiktok_title: null,
};

const defaultCreatorInfo = {
  creator_nickname: 'Dra Marina',
  creator_avatar_url: 'https://p16.tiktokcdn.com/avatar.jpg',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 180,
};

function renderPanel(
  postOverrides: Partial<typeof basePost> = {},
  propOverrides: Partial<React.ComponentProps<typeof TikTokSettingsPanel>> = {},
) {
  const onFieldChange = vi.fn();
  const onCompletenessChange = vi.fn();
  const utils = render(
    <TikTokSettingsPanel
      clientId={7}
      post={{ ...basePost, ...postOverrides } as WorkflowPost}
      onFieldChange={onFieldChange}
      onCompletenessChange={onCompletenessChange}
      {...propOverrides}
    />,
  );
  return { ...utils, onFieldChange, onCompletenessChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTikTokCreatorInfoMock.mockResolvedValue(defaultCreatorInfo);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TikTokSettingsPanel', () => {
  // ─── Fresh fetch, no caching ─────────────────────────────────
  it('fetches creator info fresh every time the panel mounts (no caching)', async () => {
    const { unmount } = renderPanel();
    await screen.findByText('Dra Marina');
    expect(getTikTokCreatorInfoMock).toHaveBeenCalledTimes(1);
    expect(getTikTokCreatorInfoMock).toHaveBeenCalledWith(7);
    unmount();

    renderPanel();
    await screen.findByText('Dra Marina');
    expect(getTikTokCreatorInfoMock).toHaveBeenCalledTimes(2);
  });

  // ─── Creator header ──────────────────────────────────────────
  it('renders the creator nickname and a sanitized avatar src', async () => {
    renderPanel();
    expect(await screen.findByText('Dra Marina')).toBeTruthy();
    const img = screen.getByTestId('tiktok-creator-avatar') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://p16.tiktokcdn.com/avatar.jpg');
  });

  it('sanitizes a dangerous avatar url instead of rendering it raw', async () => {
    getTikTokCreatorInfoMock.mockResolvedValue({
      ...defaultCreatorInfo,
      creator_avatar_url: 'javascript:alert(1)',
    });
    renderPanel();
    await screen.findByText('Dra Marina');
    const img = screen.getByTestId('tiktok-creator-avatar') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('#');
  });

  it('shows the max video duration hint for video tipos', async () => {
    renderPanel({ tipo: 'reels' });
    expect(await screen.findByText(/180/)).toBeTruthy();
  });

  // ─── Privacy select: no default preselection ────────────────
  it('has no preselected privacy value and shows the placeholder', async () => {
    renderPanel();
    await screen.findByText('Dra Marina');
    expect(screen.getByText('Selecione a privacidade')).toBeTruthy();
  });

  it('persists the chosen privacy level with audit-safe comment/duet/stitch defaults baked in', async () => {
    const { onFieldChange } = renderPanel();
    await screen.findByText('Dra Marina');
    fireEvent.click(screen.getByText('Somente eu (privado)'));
    expect(onFieldChange).toHaveBeenCalledWith(
      'tiktok_settings',
      expect.objectContaining({
        privacy_level: 'SELF_ONLY',
        disable_comment: true,
        disable_duet: true,
        disable_stitch: true,
      }),
    );
  });

  // ─── Comment/duet/stitch: unchecked by default ──────────────
  it('renders comment/duet/stitch as unchecked by default', async () => {
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    expect(screen.getByLabelText('Permitir comentários')).not.toBeChecked();
    expect(screen.getByLabelText('Permitir dueto')).not.toBeChecked();
    expect(screen.getByLabelText('Permitir stitch')).not.toBeChecked();
  });

  it('respects per-creator disabled states for comment/duet/stitch', async () => {
    getTikTokCreatorInfoMock.mockResolvedValue({
      ...defaultCreatorInfo,
      comment_disabled: true,
      duet_disabled: true,
      stitch_disabled: true,
    });
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    expect(screen.getByLabelText('Permitir comentários')).toBeDisabled();
    expect(screen.getByLabelText('Permitir dueto')).toBeDisabled();
    expect(screen.getByLabelText('Permitir stitch')).toBeDisabled();
  });

  it('checking "Permitir comentários" persists disable_comment=false', async () => {
    const { onFieldChange } = renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    fireEvent.click(screen.getByLabelText('Permitir comentários'));
    expect(onFieldChange).toHaveBeenCalledWith(
      'tiktok_settings',
      expect.objectContaining({ disable_comment: false }),
    );
  });

  // ─── Duet/stitch hidden for photo tipos ─────────────────────
  it.each(['feed', 'carrossel'] as const)(
    'hides duet/stitch controls for photo tipo %s',
    async (tipo) => {
      renderPanel({ tipo });
      await screen.findByText('Dra Marina');
      expect(screen.queryByLabelText('Permitir dueto')).toBeNull();
      expect(screen.queryByLabelText('Permitir stitch')).toBeNull();
      expect(screen.getByLabelText('Permitir comentários')).toBeTruthy();
    },
  );

  it('shows duet/stitch controls for the video tipo (reels)', async () => {
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    expect(screen.getByLabelText('Permitir dueto')).toBeTruthy();
    expect(screen.getByLabelText('Permitir stitch')).toBeTruthy();
  });

  // ─── is_aigc: video tipos only ───────────────────────────────
  it('shows the is_aigc checkbox for the video tipo (reels)', async () => {
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    expect(screen.getByLabelText('Conteúdo gerado por IA')).toBeTruthy();
  });

  it.each(['feed', 'carrossel'] as const)('hides is_aigc for photo tipo %s', async (tipo) => {
    renderPanel({ tipo });
    await screen.findByText('Dra Marina');
    expect(screen.queryByLabelText('Conteúdo gerado por IA')).toBeNull();
  });

  // ─── Title: photo tipos only ─────────────────────────────────
  it.each(['feed', 'carrossel'] as const)(
    'shows tiktok_title input for photo tipo %s',
    async (tipo) => {
      renderPanel({ tipo });
      await screen.findByText('Dra Marina');
      expect(screen.getByLabelText(/Título do TikTok/)).toBeTruthy();
    },
  );

  it('hides the tiktok_title input for the video tipo (reels)', async () => {
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    expect(screen.queryByLabelText(/Título do TikTok/)).toBeNull();
  });

  // ─── Caption counter caps ────────────────────────────────────
  it('caps the caption at 2200 runes for video tipos and blocks further typing', async () => {
    renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    const textarea = screen.getByLabelText(/Legenda do TikTok/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a'.repeat(2201) } });
    expect(textarea.value.length).toBe(0);
    expect(screen.getByText('0 / 2200')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: 'a'.repeat(2200) } });
    expect(textarea.value.length).toBe(2200);
    expect(screen.getByText('2200 / 2200')).toBeTruthy();
  });

  it('caps the caption at 4000 runes for photo tipos', async () => {
    renderPanel({ tipo: 'feed' });
    await screen.findByText('Dra Marina');
    const textarea = screen.getByLabelText(/Legenda do TikTok/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'a'.repeat(4001) } });
    expect(textarea.value.length).toBe(0);
    expect(screen.getByText('0 / 4000')).toBeTruthy();
  });

  it('caps the title at 90 characters for photo tipos', async () => {
    renderPanel({ tipo: 'feed' });
    await screen.findByText('Dra Marina');
    const input = screen.getByLabelText(/Título do TikTok/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a'.repeat(91) } });
    expect(input.value.length).toBe(0);
  });

  it('persists caption edits via onFieldChange after a debounce', async () => {
    const { onFieldChange } = renderPanel({ tipo: 'reels' });
    await screen.findByText('Dra Marina');
    vi.useFakeTimers();
    const textarea = screen.getByLabelText(/Legenda do TikTok/);
    fireEvent.change(textarea, { target: { value: 'Nova legenda do TikTok' } });
    expect(onFieldChange).not.toHaveBeenCalledWith('tiktok_caption', expect.anything());
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(onFieldChange).toHaveBeenCalledWith('tiktok_caption', 'Nova legenda do TikTok');
  });

  // ─── Commercial content toggles ──────────────────────────────
  it('shows the "Parceria paga" preview note only when brand_content_toggle is on', async () => {
    renderPanel({ tiktok_settings: { brand_content_toggle: true } });
    await screen.findByText('Dra Marina');
    expect(screen.getByText('Parceria paga')).toBeTruthy();
  });

  it('hides the "Parceria paga" note when brand_content_toggle is off', async () => {
    renderPanel();
    await screen.findByText('Dra Marina');
    expect(screen.queryByText('Parceria paga')).toBeNull();
  });

  it('toggling brand_content persists brand_content_toggle=true', async () => {
    const { onFieldChange } = renderPanel();
    await screen.findByText('Dra Marina');
    fireEvent.click(screen.getByLabelText('Conteúdo de marca — parceria paga'));
    expect(onFieldChange).toHaveBeenCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_content_toggle: true }),
    );
  });

  // ─── Music-usage confirmation gate ───────────────────────────
  it('links to the official Music Usage Confirmation page', async () => {
    renderPanel();
    await screen.findByText('Dra Marina');
    const link = screen.getByText('Confirmação de Uso de Música do TikTok').closest('a');
    expect(link?.getAttribute('href')).toBe(
      'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en',
    );
  });

  it('switches to the branded-content music confirmation copy when a brand toggle is on', async () => {
    renderPanel({ tiktok_settings: { brand_organic_toggle: true } });
    await screen.findByText('Dra Marina');
    expect(screen.getByText(/conteúdo de marca do TikTok/i)).toBeTruthy();
  });

  // ─── Schedule-blocking completeness contract (seam for C3) ──
  it('reports incomplete until privacy is chosen AND the music confirmation is ticked', async () => {
    const { onCompletenessChange } = renderPanel();
    await screen.findByText('Dra Marina');
    expect(onCompletenessChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByText('Somente eu (privado)'));
    expect(onCompletenessChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByLabelText('Confirmo que tenho os direitos de uso da música'));
    expect(onCompletenessChange).toHaveBeenLastCalledWith(true);
  });

  it('reports incomplete again if the music confirmation is unticked', async () => {
    const { onCompletenessChange } = renderPanel();
    await screen.findByText('Dra Marina');
    fireEvent.click(screen.getByText('Somente eu (privado)'));
    const musicCheckbox = screen.getByLabelText('Confirmo que tenho os direitos de uso da música');
    fireEvent.click(musicCheckbox);
    expect(onCompletenessChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(musicCheckbox);
    expect(onCompletenessChange).toHaveBeenLastCalledWith(false);
  });

  // ─── Test-mode banner (server-authoritative, reactive only) ─
  it('does not show the test-mode banner by default', async () => {
    renderPanel();
    await screen.findByText('Dra Marina');
    expect(screen.queryByText(/modo de teste/)).toBeNull();
  });

  it('shows the test-mode banner when the parent sets showTestModeBanner', async () => {
    renderPanel({}, { showTestModeBanner: true });
    await screen.findByText('Dra Marina');
    expect(
      screen.getByText('App em modo de teste: publicações TikTok saem como privadas'),
    ).toBeTruthy();
  });

  // ─── Never renders for stories (defensive; TikTok has no Stories API) ─
  it('renders nothing for tipo stories', async () => {
    const { container } = renderPanel({ tipo: 'stories' });
    expect(container.innerHTML).toBe('');
    // The fetch effect still runs (hooks execute unconditionally before the tipo
    // guard) — wait for it so its state update doesn't leak into the next test.
    await waitFor(() => expect(getTikTokCreatorInfoMock).toHaveBeenCalled());
  });
});
