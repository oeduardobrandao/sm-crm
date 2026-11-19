export interface MediaEnv {
  width: number;
  height: number;
  hover: 'none' | 'hover';
  pointer: 'none' | 'coarse' | 'fine';
  media?: 'screen' | 'print';
  /**
   * `window.screen` size; defaults to `width` x `height`. Set it to change the viewport
   * alone, e.g. the iOS app keyboard shrinking the web view.
   */
  screen?: { width: number; height: number };
}

/**
 * Evaluates a media query list (comma = OR, `and`-joined features) against `env`.
 * Unknown features throw unless `unknownFeatures: 'true'`.
 */
export function matchesQuery(
  query: string,
  env: MediaEnv,
  opts: { unknownFeatures?: 'throw' | 'true' } = {},
): boolean {
  const media = env.media ?? 'screen';
  return query.split(',').some((branch) =>
    branch
      .trim()
      .split(/\s+and\s+/)
      .every((raw) => {
        const part = raw.trim();
        if (part === 'screen' || part === 'print') return part === media;
        const m = /^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/.exec(part);
        if (m) {
          const [, feature, value] = m;
          const px = parseFloat(value);
          switch (feature) {
            case 'min-width':
              return env.width >= px;
            case 'max-width':
              return env.width <= px;
            case 'min-height':
              return env.height >= px;
            case 'max-height':
              return env.height <= px;
            case 'hover':
              return env.hover === value;
            case 'pointer':
              return env.pointer === value;
          }
        }
        if (opts.unknownFeatures === 'true') return true;
        throw new Error(`matchesQuery: unsupported media feature "${part}"`);
      }),
  );
}

type Listener = (e: MediaQueryListEvent) => void;

interface Registration {
  query: string;
  listener: Listener;
  last: boolean;
}

/**
 * Installs a `window.matchMedia` that answers from `env` (also sets innerWidth/innerHeight and
 * `window.screen` width/height), and lets a test change `env` and fire `change` on listeners
 * whose result flipped.
 */
export function mockMatchMediaEnv(initial: MediaEnv) {
  let env = initial;
  const registrations = new Set<Registration>();
  const original = {
    matchMedia: window.matchMedia,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: Object.getOwnPropertyDescriptor(window.screen, 'width'),
    screenHeight: Object.getOwnPropertyDescriptor(window.screen, 'height'),
  };
  const evaluate = (query: string) => matchesQuery(query, env, { unknownFeatures: 'true' });
  const applySize = () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: env.width,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: env.height,
    });
    const screen = env.screen ?? { width: env.width, height: env.height };
    for (const side of ['width', 'height'] as const) {
      Object.defineProperty(window.screen, side, {
        configurable: true,
        writable: true,
        value: screen[side],
      });
    }
  };
  applySize();

  const register = (query: string, listener: Listener) => {
    for (const r of registrations) {
      if (r.query === query && r.listener === listener) return;
    }
    registrations.add({ query, listener, last: evaluate(query) });
  };
  const unregister = (query: string, listener: Listener) => {
    for (const r of registrations) {
      if (r.query === query && r.listener === listener) registrations.delete(r);
    }
  };

  window.matchMedia = ((query: string) => {
    const mql = {
      media: query,
      onchange: null,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (type: string, listener: Listener) => {
        if (type === 'change') register(query, listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === 'change') unregister(query, listener);
      },
      addListener: (listener: Listener) => register(query, listener),
      removeListener: (listener: Listener) => unregister(query, listener),
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    /** Also fires `resize` on window when the viewport or screen size changed, as a browser does. */
    setEnv(next: MediaEnv) {
      const prev = env;
      env = next;
      applySize();
      for (const r of [...registrations]) {
        const now = evaluate(r.query);
        if (now !== r.last) {
          r.last = now;
          r.listener({ matches: now, media: r.query } as MediaQueryListEvent);
        }
      }
      const size = (e: MediaEnv) =>
        [e.width, e.height, e.screen?.width ?? e.width, e.screen?.height ?? e.height].join();
      if (size(prev) !== size(next)) window.dispatchEvent(new Event('resize'));
    },
    restore() {
      window.matchMedia = original.matchMedia;
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: original.innerWidth,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        writable: true,
        value: original.innerHeight,
      });
      // jsdom's screen size lives on Screen.prototype: drop the own override, or put back
      // one that was there before.
      for (const [side, desc] of [
        ['width', original.screenWidth],
        ['height', original.screenHeight],
      ] as const) {
        if (desc) Object.defineProperty(window.screen, side, desc);
        else delete (window.screen as unknown as Record<string, unknown>)[side];
      }
      registrations.clear();
    },
  };
}
