import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { downloadMedia } from '../downloadMedia';

vi.mock('sonner', () => ({ toast: vi.fn() }));

const OBJECT_URL = 'blob:mock-object-url';

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['bytes']), { status: 200 })),
  );
  URL.createObjectURL = vi.fn(() => OBJECT_URL);
  URL.revokeObjectURL = vi.fn();
  // jsdom has no navigation, so a real anchor click would warn. Record instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  // jsdom has neither; the native tests define them.
  delete (navigator as unknown as { share?: unknown }).share;
  delete (navigator as unknown as { canShare?: unknown }).canShare;
});

function asNativeApp(share: (data: ShareData) => Promise<void>, canShare = true) {
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  };
  Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true });
  Object.defineProperty(navigator, 'canShare', {
    value: vi.fn(() => canShare),
    configurable: true,
  });
}

function domError(name: string) {
  return new DOMException('x', name);
}

describe('downloadMedia', () => {
  it('saves the file under its original filename', async () => {
    await downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' });

    expect(fetch).toHaveBeenCalledWith('https://media.test/abc.png', expect.anything());
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('capa.png');
    expect(clicked[0].href).toBe(OBJECT_URL);
  });

  it('releases the object url and detaches the anchor', async () => {
    await downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('rejects media with no url without fetching', async () => {
    await expect(downloadMedia({ url: null, original_filename: 'capa.png' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates a failed download so the caller can surface it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 })),
    );

    await expect(
      downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' }),
    ).rejects.toThrow(/403/);
    expect(clicked).toHaveLength(0);
  });
});

describe('downloadMedia in the iOS app', () => {
  it('opens the share sheet with the file under its original name, never a blob link', async () => {
    asNativeApp(async () => {});

    const outcome = await downloadMedia({
      url: 'https://media.test/abc.png',
      original_filename: 'capa.png',
    });

    expect(outcome).toBe('shared');
    expect(clicked).toHaveLength(0);
    const { files } = vi.mocked(navigator.share).mock.calls[0][0] as { files: File[] };
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('capa.png');
  });

  it('reports a closed share sheet as cancelled, not as a failure', async () => {
    asNativeApp(async () => {
      throw domError('AbortError');
    });

    await expect(
      downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' }),
    ).resolves.toBe('cancelled');
  });

  it('fails instead of clicking a dead blob link when the web view cannot share files', async () => {
    asNativeApp(async () => {}, false);

    await expect(
      downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' }),
    ).rejects.toThrow();
    expect(navigator.share).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });
});

describe('a slow download in the iOS app', () => {
  it('keeps the file and shares it on the next tap without downloading again', async () => {
    let calls = 0;
    asNativeApp(async () => {
      calls += 1;
      // WebKit refuses the sheet once the tap that started the download expired.
      if (calls === 1) throw domError('NotAllowedError');
    });
    const media = { url: 'https://media.test/slow.mp4', original_filename: 'reel.mp4' };

    await expect(downloadMedia(media)).resolves.toBe('pending');
    expect(toast).toHaveBeenCalledWith('Arquivo pronto. Toque em baixar de novo para salvar.');

    await expect(downloadMedia(media)).resolves.toBe('shared');
    expect(fetch).toHaveBeenCalledTimes(1);
    const { files } = vi.mocked(navigator.share).mock.calls[1][0] as { files: File[] };
    expect(files[0].name).toBe('reel.mp4');
  });

  it('downloads again for a different file', async () => {
    let calls = 0;
    asNativeApp(async () => {
      calls += 1;
      if (calls === 1) throw domError('NotAllowedError');
    });

    await downloadMedia({ url: 'https://media.test/a.png', original_filename: 'a.png' });
    await downloadMedia({ url: 'https://media.test/b.png', original_filename: 'b.png' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('propagates other share errors so the caller can surface them', async () => {
    asNativeApp(async () => {
      throw domError('DataError');
    });

    await expect(
      downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' }),
    ).rejects.toThrow();
  });
});

describe('downloadMedia in an app binary with the native download', () => {
  function asNativeBinary(
    shareFiles: (opts: unknown) => Promise<unknown>,
    methods = ['shareFiles'],
  ) {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      isPluginAvailable: (name: string) => name === 'MesaasNative',
      PluginHeaders: [{ name: 'MesaasNative', methods: methods.map((name) => ({ name })) }],
      Plugins: { MesaasNative: { shareFiles: vi.fn(shareFiles) } },
    };
    return (
      window as unknown as {
        Capacitor: { Plugins: { MesaasNative: { shareFiles: ReturnType<typeof vi.fn> } } };
      }
    ).Capacitor.Plugins.MesaasNative.shareFiles;
  }

  it('hands the url to the native side, so the page never downloads the bytes', async () => {
    const shareFiles = asNativeBinary(async () => ({ completed: true }));

    const outcome = await downloadMedia({
      url: 'https://media.test/reel.mov',
      original_filename: 'Reel.mov',
    });

    expect(outcome).toBe('shared');
    expect(shareFiles).toHaveBeenCalledWith({
      files: [{ url: 'https://media.test/reel.mov', filename: 'Reel.mov' }],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('reports a closed sheet as cancelled', async () => {
    asNativeBinary(async () => ({ completed: false }));

    await expect(
      downloadMedia({ url: 'https://media.test/reel.mov', original_filename: 'Reel.mov' }),
    ).resolves.toBe('cancelled');
  });

  it('surfaces the native error, e.g. an expired link', async () => {
    asNativeBinary(async () => {
      throw new Error('HTTP 410');
    });

    await expect(
      downloadMedia({ url: 'https://media.test/reel.mov', original_filename: 'Reel.mov' }),
    ).rejects.toThrow('HTTP 410');
  });

  it('falls back to the web view share sheet on a binary without the method', async () => {
    const shareFiles = asNativeBinary(async () => ({ completed: true }), ['openUrl']);
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => {}), configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });

    const outcome = await downloadMedia({
      url: 'https://media.test/abc.png',
      original_filename: 'capa.png',
    });

    expect(outcome).toBe('shared');
    expect(shareFiles).not.toHaveBeenCalled();
    expect(navigator.share).toHaveBeenCalledTimes(1);
  });
});
