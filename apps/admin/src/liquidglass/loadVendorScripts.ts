const H2C_ID = 'lgl-html2canvas';
const LGL_ID = 'lgl-liquidgl';

let cached: Promise<void> | null = null;

function injectScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`failed to load ${id}`)));
      return;
    }
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.async = false; // preserve order: html2canvas must define its global before liquidGL
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true';
      resolve();
    });
    el.addEventListener('error', () => reject(new Error(`failed to load ${id}`)));
    document.head.appendChild(el);
  });
}

export function loadVendorScripts(): Promise<void> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL; // '/admin/' in prod, '/' in dev
  cached = injectScript(H2C_ID, `${base}vendor/html2canvas.min.js`)
    .then(() => injectScript(LGL_ID, `${base}vendor/liquidGL.js`))
    .then(() => {
      if (typeof window.html2canvas === 'undefined' || typeof window.liquidGL === 'undefined') {
        throw new Error('liquidGL globals missing after load');
      }
    });
  return cached;
}

/** Test-only: clear the module-level memo between tests. */
export function __resetVendorScriptsCache(): void {
  cached = null;
}
