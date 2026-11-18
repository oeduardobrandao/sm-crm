export interface MediaEnv {
  width: number;
  height: number;
  hover: 'none' | 'hover';
  pointer: 'none' | 'coarse' | 'fine';
  media?: 'screen' | 'print';
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
 * Installs a `window.matchMedia` that answers from `env` (also sets innerWidth/innerHeight),
 * and lets a test change `env` and fire `change` on listeners whose result flipped.
 */
export function mockMatchMediaEnv(initial: MediaEnv) {
  let env = initial;
  const registrations = new Set<Registration>();
  const original = {
    matchMedia: window.matchMedia,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
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
  };
  applySize();

  window.matchMedia = ((query: string) => {
    const mql = {
      media: query,
      onchange: null,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (type: string, listener: Listener) => {
        if (type === 'change') registrations.add({ query, listener, last: evaluate(query) });
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type !== 'change') return;
        for (const r of registrations) {
          if (r.query === query && r.listener === listener) registrations.delete(r);
        }
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    setEnv(next: MediaEnv) {
      env = next;
      applySize();
      for (const r of [...registrations]) {
        const now = evaluate(r.query);
        if (now !== r.last) {
          r.last = now;
          r.listener({ matches: now, media: r.query } as MediaQueryListEvent);
        }
      }
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
      registrations.clear();
    },
  };
}
