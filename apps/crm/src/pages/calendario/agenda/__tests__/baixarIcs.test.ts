import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
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
    vi.useFakeTimers();

    await baixarIcsDaOcorrencia(o);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/agenda-feed\/ocorrencia\/42\.ics$/);
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([{ download: 'gravacao-clinica-sorriso.ics', href: 'blob:fake' }]);
    // Revoked later, not synchronously (Safari would cancel the download).
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
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

describe('baixarIcsDaOcorrencia in the iOS app', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (navigator as unknown as { share?: unknown }).share;
    delete (navigator as unknown as { canShare?: unknown }).canShare;
  });

  it('opens the share sheet with <slug>.ics instead of a dead blob link', async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    };
    // jsdom's Blob has no arrayBuffer(), which the share path reads.
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('File', NodeFile);
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' }),
    });

    await baixarIcsDaOcorrencia(o);

    expect(clicked).toEqual([]);
    const { files } = share.mock.calls[0][0] as { files: File[] };
    expect(files[0].name).toBe('gravacao-clinica-sorriso.ics');
    expect(files[0].type).toBe('text/calendar');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

describe('baixarIcsDaOcorrencia in an app binary that adds to the calendar', () => {
  function asCalendarBinary(
    addCalendarEvent: (opts: unknown) => Promise<unknown> = async () => ({ saved: true }),
  ) {
    const fn = vi.fn(addCalendarEvent);
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      isPluginAvailable: (name: string) => name === 'MesaasNative',
      PluginHeaders: [
        {
          name: 'MesaasNative',
          methods: [{ name: 'shareFiles' }, { name: 'addCalendarEvent' }],
        },
      ],
      Plugins: { MesaasNative: { addCalendarEvent: fn, shareFiles: vi.fn() } },
    };
    return fn;
  }

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  const timed = {
    ...o,
    descricao: ' Roteiro na pasta ',
    local: 'Rua A, 10',
    link_reuniao: 'https://meet.test/abc',
    dia_inteiro: false,
    inicio: '2026-11-21T13:00:00+00:00',
    fim: '2026-11-21T14:30:00+00:00',
    data_inicio_local: '2026-11-21',
    data_fim_local: '2026-11-21',
  } as AgendaOcorrencia;

  it('opens the native New Event screen for a timed event, never fetching the .ics', async () => {
    const add = asCalendarBinary();

    await baixarIcsDaOcorrencia(timed);

    expect(add).toHaveBeenCalledWith({
      title: 'Gravação: Clínica Sorriso',
      notes: 'Roteiro na pasta\n\nLink da reunião: https://meet.test/abc',
      location: 'Rua A, 10',
      url: 'https://meet.test/abc',
      allDay: false,
      start: '2026-11-21T13:00:00+00:00',
      end: '2026-11-21T14:30:00+00:00',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('sends local days for an all-day event and omits empty fields', async () => {
    const add = asCalendarBinary();

    await baixarIcsDaOcorrencia({
      ...o,
      dia_inteiro: true,
      descricao: null,
      local: '  ',
      link_reuniao: null,
      data_inicio_local: '2026-11-24',
      data_fim_local: '2026-11-26',
    } as AgendaOcorrencia);

    expect(add).toHaveBeenCalledWith({
      title: 'Gravação: Clínica Sorriso',
      notes: undefined,
      location: undefined,
      url: undefined,
      allDay: true,
      startDay: '2026-11-24',
      endDay: '2026-11-26',
    });
  });

  it('treats a cancelled editor as done, without a toast', async () => {
    asCalendarBinary(async () => ({ saved: false }));

    await baixarIcsDaOcorrencia(timed);

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('toasts when calendar access is denied', async () => {
    asCalendarBinary(async () => {
      throw new Error('DENIED');
    });

    await baixarIcsDaOcorrencia(timed);

    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível baixar o arquivo.');
  });

  it('adds nothing for a masked occurrence', async () => {
    const add = asCalendarBinary();

    await baixarIcsDaOcorrencia({ ...timed, mascarado: true } as AgendaOcorrencia);

    expect(add).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Não foi possível baixar o arquivo.');
  });
});
