import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { openPdf, pdfFilename, pdfLinkClick } from '../openPdf';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const URL_PDF = 'https://files.example.com/reports/6.pdf?sig=abc';

function asAppBinary(shareFiles: (opts: unknown) => Promise<unknown>, methods = ['shareFiles']) {
  const fn = vi.fn(shareFiles);
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) => name === 'MesaasNative',
    PluginHeaders: [{ name: 'MesaasNative', methods: methods.map((name) => ({ name })) }],
    Plugins: { MesaasNative: { shareFiles: fn } },
  };
  return fn;
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe('pdfFilename', () => {
  it('keeps the title and drops characters Files cannot take', () => {
    expect(pdfFilename('Relatório Clínica / Aurora: Jul 2026')).toBe(
      'Relatório Clínica Aurora Jul 2026.pdf',
    );
  });

  it('falls back to a generic name', () => {
    expect(pdfFilename('  ')).toBe('relatorio.pdf');
    expect(pdfFilename(null)).toBe('relatorio.pdf');
  });
});

describe('openPdf', () => {
  it('opens a new tab on the web', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openPdf(URL_PDF, 'Relatório.pdf');
    expect(open).toHaveBeenCalledWith(URL_PDF, '_blank', 'noopener,noreferrer');
  });

  it('hands the url to the share sheet in the app instead of leaving for Safari', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const shareFiles = asAppBinary(async () => ({ completed: true }));

    await openPdf(URL_PDF, 'Relatório Jul 2026.pdf');

    expect(shareFiles).toHaveBeenCalledWith({
      files: [{ url: URL_PDF, filename: 'Relatório Jul 2026.pdf' }],
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('tells the user when the native download fails (e.g. an expired link)', async () => {
    asAppBinary(async () => {
      throw new Error('HTTP 403');
    });
    await openPdf(URL_PDF, 'Relatório.pdf');
    expect(toast.error).toHaveBeenCalledWith('Não foi possível abrir o PDF. Tente novamente.');
  });

  it('keeps opening Safari on an app binary without the native download', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const shareFiles = asAppBinary(async () => ({ completed: true }), ['openUrl']);
    await openPdf(URL_PDF, 'Relatório.pdf');
    expect(shareFiles).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('pdfLinkClick', () => {
  it('leaves the link alone on the web', () => {
    const e = { preventDefault: vi.fn() };
    pdfLinkClick(URL_PDF, 'Relatório.pdf')(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('takes the share sheet in the app', () => {
    const shareFiles = asAppBinary(async () => ({ completed: true }));
    const e = { preventDefault: vi.fn() };
    pdfLinkClick(URL_PDF, 'Relatório.pdf')(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(shareFiles).toHaveBeenCalledWith({
      files: [{ url: URL_PDF, filename: 'Relatório.pdf' }],
    });
  });
});
