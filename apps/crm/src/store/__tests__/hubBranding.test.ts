import { describe, it, expect, vi, beforeEach } from 'vitest';

// See membership.test.ts for why vi.hoisted() is required here: the '../workspace'
// import below pulls in '../core', which runs this factory before any plain
// top-level const in this file would be initialized.
const { mockSingle, mockUpdateEq, mockGetContaId, mockFrom } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockUpdateEq: vi.fn(),
  mockGetContaId: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getContaId: mockGetContaId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
  getUserId: vi.fn(),
}));

import {
  getHubBranding,
  updateHubBranding,
  updateWorkspaceBranding,
  getWorkspaceBranding,
} from '../workspace';

const ROW = {
  brand_color: '#eab308',
  hub_surface_theme: 'warm',
  hub_font_display: 'sora',
  hub_font_body: 'manrope',
  hub_radius: 'pill',
  hub_card_style: 'outline',
  hub_logo_style: 'wordmark',
  hub_logo_dark_url: 'https://cdn.example.com/logo-dark.png',
  hub_hide_branding: true,
  hub_default_appearance: 'dark',
};

describe('getHubBranding / updateHubBranding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
      update: () => ({ eq: mockUpdateEq }),
    }));
  });

  it('returns the hub branding row for the active workspace', async () => {
    mockSingle.mockResolvedValue({ data: ROW, error: null });
    await expect(getHubBranding()).resolves.toEqual(ROW);
    expect(mockFrom).toHaveBeenCalledWith('workspaces');
  });

  it('throws on a query error instead of silently returning defaults', async () => {
    const queryError = { message: 'column does not exist' };
    mockSingle.mockResolvedValue({ data: null, error: queryError });
    await expect(getHubBranding()).rejects.toBe(queryError);
  });

  it('updates only the fields passed in', async () => {
    mockUpdateEq.mockResolvedValue({ error: null });
    await updateHubBranding({ hub_radius: 'square', hub_hide_branding: false });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'ws-1');
  });

  it('throws when the update fails', async () => {
    const updateError = { message: 'boom' };
    mockUpdateEq.mockResolvedValue({ error: updateError });
    await expect(updateHubBranding({ hub_radius: 'square' })).rejects.toBe(updateError);
  });
});

describe('updateWorkspaceBranding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockFrom.mockImplementation(() => ({
      update: () => ({ eq: mockUpdateEq }),
    }));
  });

  it('no longer accepts brand_color at the type level — updateHubBranding is its one writer', async () => {
    mockUpdateEq.mockResolvedValue({ error: null });
    // @ts-expect-error brand_color moved to updateHubBranding; this call would not compile.
    await updateWorkspaceBranding({ brand_color: '#000000', send_report_email: true });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'ws-1');
  });

  // Central de Notificações, Fase 2 (spec 2026-09-02): "Pendências do Hub" master
  // switch writes workspaces.send_client_event_emails through this same writer.
  it('accepts send_client_event_emails alongside send_report_email', async () => {
    mockUpdateEq.mockResolvedValue({ error: null });
    await updateWorkspaceBranding({ send_client_event_emails: true });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'ws-1');
  });
});

describe('getWorkspaceBranding', () => {
  const mockSelectFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockSelectFn.mockReset().mockReturnValue({ eq: () => ({ single: mockSingle }) });
    mockFrom.mockImplementation(() => ({ select: mockSelectFn }));
  });

  it('selects and returns send_client_event_emails alongside the existing report fields', async () => {
    const row = {
      brand_color: '#eab308',
      report_splash_url: null,
      send_report_email: true,
      send_client_event_emails: true,
    };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const result = await getWorkspaceBranding();

    expect(mockSelectFn).toHaveBeenCalledWith(
      'brand_color, report_splash_url, send_report_email, send_client_event_emails',
    );
    expect(result).toEqual(row);
  });
});
