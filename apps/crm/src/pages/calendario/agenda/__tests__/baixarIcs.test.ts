import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';

const { getSessionMock, toastErrorMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: getSessionMock } } }));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }));

import { baixarIcsDaOcorrencia, slugDoTitulo } from '../baixarIcs';

const o = { ocorrencia_id: 42, titulo: 'Gravação: Clínica Sorriso' } as AgendaOcorrencia;

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let clicked: { download: string; href: string }[];

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
  toastErrorMock.mockReset();
  createObjectURL = vi.fn(() => 'blob:fake');
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('slugDoTitulo', () => {
  it('lowercases, strips accents and collapses punctuation into dashes', () => {
    expect(slugDoTitulo('Gravação: Clínica Sorriso')).toBe('gravacao-clinica-sorriso');
    expect(slugDoTitulo('  --Q&A #1--  ')).toBe('q-a-1');
  });

  it('caps at 60 characters without a trailing dash', () => {
    const slug = slugDoTitulo(`${'a'.repeat(59)} bbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "evento" when nothing alphanumeric is left', () => {
    expect(slugDoTitulo('!!! ???')).toBe('evento');
    expect(slugDoTitulo('')).toBe('evento');
  });
});

describe('baixarIcsDaOcorrencia', () => {
  it('fetches the occurrence route with the session JWT and saves the blob as <slug>.ics', async () => {
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['BEGIN:VCALENDAR']) });

    await baixarIcsDaOcorrencia(o);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/agenda-feed\/ocorrencia\/42\.ics$/);
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([{ download: 'gravacao-clinica-sorriso.ics', href: 'blob:fake' }]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('toasts and downloads nothing when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await baixarIcsDaOcorrencia(o);

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível baixar o arquivo.');
    expect(clicked).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('toasts when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await baixarIcsDaOcorrencia(o);

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível baixar o arquivo.');
    expect(clicked).toEqual([]);
  });

  it('toasts when there is no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    await baixarIcsDaOcorrencia(o);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível baixar o arquivo.');
  });
});
