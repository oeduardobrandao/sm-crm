import { describe, it, expect, beforeEach } from 'vitest';
import { loadVendorScripts, __resetVendorScriptsCache } from '../loadVendorScripts';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fireLoad(id: string) {
  const el = document.getElementById(id) as HTMLScriptElement;
  el.dispatchEvent(new Event('load'));
}

describe('loadVendorScripts', () => {
  beforeEach(() => {
    __resetVendorScriptsCache();
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).html2canvas;
    delete (window as unknown as Record<string, unknown>).liquidGL;
  });

  it('injects html2canvas first, then liquidGL, resolving when both globals exist', async () => {
    (window as unknown as Record<string, unknown>).html2canvas = () => {};
    (window as unknown as Record<string, unknown>).liquidGL = Object.assign(() => {}, {
      registerDynamic() {},
    });
    const p = loadVendorScripts();
    expect(document.getElementById('lgl-html2canvas')).toBeTruthy();
    fireLoad('lgl-html2canvas');
    await flush();
    expect(document.getElementById('lgl-liquidgl')).toBeTruthy();
    fireLoad('lgl-liquidgl');
    await expect(p).resolves.toBeUndefined();
  });

  it('memoizes: repeat calls return the same promise and inject once', () => {
    (window as unknown as Record<string, unknown>).html2canvas = () => {};
    (window as unknown as Record<string, unknown>).liquidGL = Object.assign(() => {}, {
      registerDynamic() {},
    });
    const p1 = loadVendorScripts();
    const p2 = loadVendorScripts();
    expect(p1).toBe(p2);
    expect(document.querySelectorAll('#lgl-html2canvas').length).toBe(1);
  });
});
