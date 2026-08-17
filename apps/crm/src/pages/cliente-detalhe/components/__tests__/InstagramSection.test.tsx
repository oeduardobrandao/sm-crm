import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// InstagramSection is the extracted (verbatim) version of the component that
// used to live inline at the bottom of ClienteDetalhePage.tsx (see git history
// at d30adeea). LatestInstagramPosts and ConnectLinkRow are separately, already
// tested components — stub them here so this suite stays focused on
// InstagramSection's own wiring: the loading/syncing/connect states, the
// ref-based imperative renderers, the auto-publish toggle (which bypasses the
// store layer on purpose — existing behavior, preserved as-is), and the
// "Ver Analytics Completo" button.

vi.mock('@/components/instagram/LatestInstagramPosts', () => ({
  LatestInstagramPosts: ({ clienteId }: { clienteId: number }) => (
    <div data-testid="latest-instagram-posts">posts-for-{clienteId}</div>
  ),
}));

vi.mock('@/components/instagram/ConnectLinkDialog', () => ({
  ConnectLinkRow: ({
    clienteId,
    clienteEmail,
  }: {
    clienteId: number;
    clienteEmail: string | null;
  }) => (
    <div data-testid="connect-link-row">
      connect-link-{clienteId}-{clienteEmail ?? 'no-email'}
    </div>
  ),
}));

// Radix Switch mocked to a plain checkbox, same convention used across the
// suite (NotificacoesTab.test.tsx, MembrosTab.test.tsx).
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label="autoPublish"
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@/lib/supabase');

import { __queueSupabaseResult, __resetSupabaseMock, __getSupabaseCalls } from '@/lib/supabase';
import { InstagramSection } from '../InstagramSection';

const IG_SUMMARY_SYNCED = {
  account: {
    username: 'aurora.estetica',
    profile_picture_url: 'https://example.com/pic.jpg',
    last_synced_at: '2026-08-10T12:00:00Z',
    followers_count: 1200,
  },
  history: [{ date: '2026-08-01', followers_count: 1150 }],
};

const IG_SUMMARY_UNSYNCED = {
  account: { username: 'aurora.estetica', last_synced_at: null },
  history: [],
};

function renderSection(props: Partial<Parameters<typeof InstagramSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetchIg = vi.fn();
  const onNavigateAnalytics = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <InstagramSection
        clienteId={42}
        clienteEmail="contato@aurora.com.br"
        loadingIg={false}
        igSummary={null}
        refetchIg={refetchIg}
        onNavigateAnalytics={onNavigateAnalytics}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, refetchIg, onNavigateAnalytics };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetSupabaseMock();
});

describe('InstagramSection', () => {
  it('shows a loading spinner while loadingIg is true, nothing else', () => {
    const { container } = renderSection({ loadingIg: true, igSummary: null });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByTestId('connect-link-row')).not.toBeInTheDocument();
  });

  it('shows a connect button when there is no igSummary', async () => {
    const { container } = renderSection({ loadingIg: false, igSummary: null });
    await waitFor(() => expect(container.querySelector('#btn-ig-connect')).not.toBeNull());
  });

  it('shows a syncing placeholder when the account has not synced yet', () => {
    renderSection({ loadingIg: false, igSummary: IG_SUMMARY_UNSYNCED });
    expect(screen.getByText('Sincronizando dados do Instagram...')).toBeInTheDocument();
  });

  it('renders the overview card, follower chart, and latest posts once synced', async () => {
    const { container } = renderSection({ loadingIg: false, igSummary: IG_SUMMARY_SYNCED });
    await waitFor(() => expect(container.querySelector('#btn-ig-sync')).not.toBeNull());
    expect(screen.getByTestId('latest-instagram-posts')).toHaveTextContent('posts-for-42');
  });

  it('shows the "Ver Analytics Completo" button once synced and calls onNavigateAnalytics', async () => {
    const { onNavigateAnalytics } = renderSection({
      loadingIg: false,
      igSummary: IG_SUMMARY_SYNCED,
    });
    const btn = await screen.findByRole('button', { name: 'Ver Analytics Completo →' });
    fireEvent.click(btn);
    expect(onNavigateAnalytics).toHaveBeenCalledTimes(1);
  });

  it('does not show the analytics button before the account has synced', () => {
    renderSection({ loadingIg: false, igSummary: IG_SUMMARY_UNSYNCED });
    expect(
      screen.queryByRole('button', { name: 'Ver Analytics Completo →' }),
    ).not.toBeInTheDocument();
  });

  it('renders ConnectLinkRow with the cliente id and email once not loading', async () => {
    renderSection({ loadingIg: false, igSummary: IG_SUMMARY_SYNCED, clienteEmail: 'x@y.com' });
    expect(await screen.findByTestId('connect-link-row')).toHaveTextContent(
      'connect-link-42-x@y.com',
    );
  });

  describe('auto-publish toggle', () => {
    it('loads the stored preference on mount and reflects it', async () => {
      __queueSupabaseResult('clientes', 'select', {
        data: { auto_publish_on_approval: true },
      });
      renderSection({ loadingIg: false, igSummary: IG_SUMMARY_SYNCED });
      const toggle = await screen.findByRole('switch');
      await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    });

    it('toggling calls supabase.from("clientes").update directly (bypasses the store layer, on purpose)', async () => {
      __queueSupabaseResult('clientes', 'select', {
        data: { auto_publish_on_approval: false },
      });
      __queueSupabaseResult('clientes', 'update', { data: null });
      renderSection({ loadingIg: false, igSummary: IG_SUMMARY_SYNCED });

      const toggle = await screen.findByRole('switch');
      await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
      fireEvent.click(toggle);

      await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
      const calls = __getSupabaseCalls();
      const updateCall = calls.find((c) => c.table === 'clientes' && c.operation === 'update');
      expect(updateCall?.payload).toEqual({ auto_publish_on_approval: true });
    });

    it('does not show the auto-publish toggle before the account has synced', () => {
      renderSection({ loadingIg: false, igSummary: IG_SUMMARY_UNSYNCED });
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
  });
});
