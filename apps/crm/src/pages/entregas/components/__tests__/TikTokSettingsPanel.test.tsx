import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    return (
      <button type="button" role="combobox">
        {children}
      </button>
    );
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({
    value,
    children,
    disabled,
  }: {
    value: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button
        type="button"
        role="option"
        disabled={disabled}
        data-disabled={disabled ? '' : undefined}
        onClick={() => onValueChange?.(value)}
      >
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
import type { PostMedia } from '../../../../store/posts';
import type { TikTokCreatorInfo } from '../../../../services/tiktok';

const basePost: Pick<
  WorkflowPost,
  'id' | 'tipo' | 'tiktok_settings' | 'tiktok_caption' | 'tiktok_title' | 'ig_caption'
> = {
  id: 42,
  tipo: 'reels',
  tiktok_settings: null,
  tiktok_caption: null,
  tiktok_title: null,
  ig_caption: null,
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

const video42 = [
  {
    id: 1,
    kind: 'video',
    duration_seconds: 42,
    media_lost_at: null,
    thumbnail_url: null,
    url: 'u',
    is_cover: true,
    sort_order: 0,
  },
] as unknown as PostMedia[];

type PanelProps = React.ComponentProps<typeof TikTokSettingsPanel>;

function reelsPost(overrides: Partial<WorkflowPost> = {}): WorkflowPost {
  return { ...basePost, ...overrides } as WorkflowPost;
}
function panelElement(props: Partial<PanelProps> & { post: WorkflowPost }) {
  return <TikTokSettingsPanel clientId={7} onFieldChange={vi.fn()} media={video42} {...props} />;
}
function renderPanelProps(props: Partial<PanelProps> & { post: WorkflowPost }) {
  return render(panelElement(props));
}
function mockCreatorInfo(info: Partial<TikTokCreatorInfo>) {
  getTikTokCreatorInfoMock.mockResolvedValue(info);
}
/** The Select mock renders each option as a button; clicking it fires onValueChange. */
async function selectPrivacy(label: string) {
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

function renderPanel(
  postOverrides: Partial<typeof basePost> = {},
  propOverrides: Partial<PanelProps> = {},
) {
  const onFieldChange = vi.fn();
  const onReadinessChange = vi.fn();
  const utils = render(
    <TikTokSettingsPanel
      clientId={7}
      post={{ ...basePost, ...postOverrides } as WorkflowPost}
      onFieldChange={onFieldChange}
      onReadinessChange={onReadinessChange}
      media={video42}
      {...propOverrides}
    />,
  );
  return { ...utils, onFieldChange, onReadinessChange };
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
      screen.getByText(
        'App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.',
      ),
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

describe('hideCaption (P2: a aba do TikTok é dona da legenda)', () => {
  it('shows the caption field by default (flag off path)', async () => {
    renderPanel();
    expect(await screen.findByText(/Legenda do TikTok/)).toBeInTheDocument();
  });

  it('hides only the caption field when hideCaption is set', async () => {
    renderPanel({ tipo: 'feed' }, { hideCaption: true });
    await screen.findByLabelText('Permitir comentários');
    expect(screen.queryByText(/Legenda do TikTok/)).toBeNull();
    expect(screen.getByText('Título do TikTok (opcional)')).toBeInTheDocument();
  });
});

describe('readiness contract (spec A0)', () => {
  it('reports readiness with a reason, and completes once privacy is chosen', async () => {
    mockCreatorInfo({
      privacy_level_options: ['SELF_ONLY'],
      can_post: true,
      app_audited: false,
      max_video_post_duration_sec: 600,
    });
    const onReadinessChange = vi.fn();
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }), onReadinessChange });
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({
        complete: false,
        reason: 'Escolha a privacidade do post no TikTok.',
      }),
    );
    await selectPrivacy('Somente eu (privado)');
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: true }));
  });

  it('reports the creator-info loading reason first', async () => {
    const onReadinessChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }),
      onReadinessChange,
    });
    expect(onReadinessChange).toHaveBeenCalledWith({
      complete: false,
      reason: 'Carregando informações do criador no TikTok…',
    });
    await screen.findByText('Dra Marina');
    await waitFor(() => expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: true }));
  });

  it('a creator-info failure blocks with its message', async () => {
    getTikTokCreatorInfoMock.mockRejectedValue(new Error('Erro X'));
    const onReadinessChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }),
      onReadinessChange,
    });
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({ complete: false, reason: 'Erro X' }),
    );
  });

  it('media undefined reports loading; mediaError reports the error', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const onReadinessChange = vi.fn();
    const post = reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } });
    const { rerender } = renderPanelProps({ post, media: undefined, onReadinessChange });
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({
        complete: false,
        reason: 'Carregando mídias do post…',
      }),
    );
    rerender(panelElement({ post, media: undefined, mediaError: true, onReadinessChange }));
    await waitFor(() =>
      expect(onReadinessChange).toHaveBeenLastCalledWith({
        complete: false,
        reason: 'Não foi possível carregar as mídias. Reabra o post.',
      }),
    );
  });
});

describe('commercial content disclosure (spec A1/A2/A7)', () => {
  it('master off by default; on reveals two checkboxes; nothing checked warns', async () => {
    mockCreatorInfo({
      privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
      app_audited: true,
    });
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }),
    });
    const master = await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' });
    expect(master).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Sua marca/ })).toBeNull();
    fireEvent.click(master);
    expect(screen.getByRole('checkbox', { name: /Sua marca/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeInTheDocument();
    expect(
      screen.getByText('Indique se o conteúdo promove você, um terceiro ou ambos.'),
    ).toBeInTheDocument();
  });

  it('"Sua marca" shows Conteúdo promocional; adding branded shows Parceria paga and persists both', async () => {
    mockCreatorInfo({
      privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
      app_audited: true,
    });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }),
      onFieldChange,
    });
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Sua marca/ }));
    expect(screen.getByText(/Seu post será rotulado como/)).toHaveTextContent(
      'Seu post será rotulado como Conteúdo promocional.',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Conteúdo de marca/ }));
    expect(screen.getByText(/Seu post será rotulado como/)).toHaveTextContent(
      'Seu post será rotulado como Parceria paga.',
    );
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_organic_toggle: true, brand_content_toggle: true }),
    );
  });

  it('turning the master on persists nothing until a checkbox is ticked', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({ tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }),
      onFieldChange,
    });
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }),
    );
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('turning the master off persists both toggles false', async () => {
    mockCreatorInfo({ privacy_level_options: ['PUBLIC_TO_EVERYONE'], app_audited: true });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({
        tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE', brand_organic_toggle: true },
      }),
      onFieldChange,
    });
    const master = await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' });
    expect(master).toBeChecked();
    fireEvent.click(master);
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_organic_toggle: false, brand_content_toggle: false }),
    );
    expect(screen.queryByRole('checkbox', { name: /Sua marca/ })).toBeNull();
  });

  it('unaudited: branded disabled with suffix; non-SELF_ONLY options disabled; banner always shown', async () => {
    mockCreatorInfo({
      privacy_level_options: ['FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
      app_audited: false,
    });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(
      await screen.findByText(
        'App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Divulgação de conteúdo comercial' }));
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeDisabled();
    expect(screen.getByTestId('tt-branded-suffix')).toHaveTextContent(
      '(disponível após a aprovação do app)',
    );
    expect(screen.getByRole('option', { name: /Seguidores/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: /Seguidores/ })).toHaveTextContent(
      '(disponível após a aprovação do app)',
    );
    expect(screen.getByRole('option', { name: 'Somente eu (privado)' })).toBeEnabled();
  });

  it('audited: SELF_ONLY chosen disables branded with the helper line', async () => {
    mockCreatorInfo({
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      app_audited: true,
    });
    renderPanelProps({ post: reelsPost({ tiktok_settings: { privacy_level: 'SELF_ONLY' } }) });
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Divulgação de conteúdo comercial' }),
    );
    expect(screen.getByRole('checkbox', { name: /Conteúdo de marca/ })).toBeDisabled();
    expect(
      screen.getByText('Conteúdo de marca não pode ter visibilidade privada.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tt-branded-suffix')).toBeNull();
  });

  it('audited: branded checked disables the SELF_ONLY option with its suffix', async () => {
    mockCreatorInfo({
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      app_audited: true,
    });
    renderPanelProps({
      post: reelsPost({
        tiktok_settings: { privacy_level: 'PUBLIC_TO_EVERYONE', brand_content_toggle: true },
      }),
    });
    const selfOnly = await screen.findByRole('option', { name: /Somente eu/ });
    expect(selfOnly).toBeDisabled();
    expect(selfOnly).toHaveTextContent('(não disponível para conteúdo de marca)');
    expect(screen.getByRole('option', { name: 'Todos' })).toBeEnabled();
  });

  it('legacy branded + SELF_ONLY row shows the inline error and keeps branded uncheckable', async () => {
    mockCreatorInfo({
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      app_audited: true,
    });
    const onFieldChange = vi.fn();
    renderPanelProps({
      post: reelsPost({
        tiktok_settings: { privacy_level: 'SELF_ONLY', brand_content_toggle: true },
      }),
      onFieldChange,
    });
    expect(
      await screen.findByText('A visibilidade de conteúdo de marca não pode ser privada.'),
    ).toBeInTheDocument();
    const branded = screen.getByRole('checkbox', { name: /Conteúdo de marca/ });
    expect(branded).toBeEnabled();
    fireEvent.click(branded);
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'tiktok_settings',
      expect.objectContaining({ brand_content_toggle: false }),
    );
  });
});

describe('notices, preview and duration (spec A4/A5/A6/A7)', () => {
  it('can_post false replaces the nickname header with the pt-BR notice', async () => {
    mockCreatorInfo({
      can_post: false,
      cannot_post_reason: 'spam_risk_too_many_posts',
      app_audited: false,
    });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.',
    );
    expect(screen.queryByTestId('tiktok-creator-avatar')).toBeNull();
  });

  it('can_post false with an unknown reason uses the fallback sentence', async () => {
    mockCreatorInfo({ can_post: false, cannot_post_reason: 'something_new' });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O TikTok não permite novas publicações nesta conta agora. Tente novamente mais tarde.',
    );
  });

  it('public account in test mode shows the blocking warning', async () => {
    mockCreatorInfo({
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      app_audited: false,
    });
    renderPanelProps({ post: reelsPost({ tiktok_settings: {} }) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.',
    );
  });

  it('preview shows the duration badge and the caption that will be sent', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    renderPanelProps({
      post: reelsPost({ tiktok_caption: 'Legenda do TikTok', tiktok_settings: {} }),
    });
    const preview = await screen.findByRole('region', { name: 'Prévia' });
    expect(within(preview).getByText('0:42')).toBeInTheDocument();
    expect(within(preview).getByText('Legenda do TikTok')).toBeInTheDocument();
  });

  it('preview falls back to ig_caption and shows +N beyond five thumbnails', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...video42[0],
      id: i + 1,
      kind: 'image',
      duration_seconds: null,
      url: `https://cdn.example/${i}.jpg`,
    })) as unknown as PostMedia[];
    renderPanelProps({
      post: reelsPost({
        tipo: 'carrossel',
        tiktok_caption: null,
        ig_caption: 'Legenda do IG',
        tiktok_settings: {},
      }),
      media: seven,
    });
    const preview = await screen.findByRole('region', { name: 'Prévia' });
    expect(preview.querySelectorAll('img')).toHaveLength(5);
    expect(within(preview).getByText('+2')).toBeInTheDocument();
    expect(within(preview).getByText('Legenda do IG')).toBeInTheDocument();
  });

  it('preview: empty media and lost media messages', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'] });
    const post = reelsPost({ tiktok_settings: {} });
    const { rerender } = renderPanelProps({ post, media: [] });
    expect(
      await screen.findByText('Adicione mídia ao post para publicar no TikTok.'),
    ).toBeInTheDocument();
    rerender(
      panelElement({
        post,
        media: [{ ...video42[0], media_lost_at: '2026-08-14' }] as unknown as PostMedia[],
      }),
    );
    expect(
      await screen.findByText(
        'Uma das mídias deste post foi perdida. Substitua-a antes de publicar.',
      ),
    ).toBeInTheDocument();
  });

  it('video over the creator limit shows the duration error', async () => {
    mockCreatorInfo({ privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 });
    renderPanelProps({
      post: reelsPost({ tiktok_settings: {} }),
      media: [{ ...video42[0], duration_seconds: 750 }] as unknown as PostMedia[],
    });
    expect(
      await screen.findByText('Este vídeo tem 750s. O máximo permitido para esta conta é 600s.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Duração máxima de vídeo nesta conta: 600s')).toBeInTheDocument();
  });
});
