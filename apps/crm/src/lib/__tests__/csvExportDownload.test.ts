import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { toast } from 'sonner';
import { downloadCsv } from '../csvExport';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:csv');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockReset();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  delete (navigator as unknown as { share?: unknown }).share;
  delete (navigator as unknown as { canShare?: unknown }).canShare;
});

function asIosApp(share: (data: ShareData) => Promise<void>, canShare = true) {
  // jsdom's Blob has no arrayBuffer()/text(), which the share path reads.
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  };
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => canShare, configurable: true });
}

describe('downloadCsv', () => {
  it('downloads the file in the browser', async () => {
    await expect(downloadCsv('a;b', 'contatos.csv')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('contatos.csv');
  });

  it('opens the share sheet with the CSV in the iOS app, never a blob link', async () => {
    asIosApp(async () => {});

    await expect(downloadCsv('a;b', 'contatos.csv')).resolves.toBe('shared');

    expect(clicked).toHaveLength(0);
    const { files } = vi.mocked(navigator.share).mock.calls[0][0] as { files: File[] };
    expect(files[0].name).toBe('contatos.csv');
    expect(files[0].type).toBe('text/csv;charset=utf-8');
    expect(await files[0].text()).toBe('a;b');
  });

  it('toasts instead of rejecting when the app cannot share the file', async () => {
    asIosApp(async () => {}, false);

    await expect(downloadCsv('a;b', 'contatos.csv')).resolves.toBeNull();

    expect(toast.error).toHaveBeenCalledWith('Erro ao baixar arquivo');
    expect(clicked).toHaveLength(0);
  });
});
