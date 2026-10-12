import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/** What a page puts in the desktop Vidro toolbar (spec: usePageToolbar). */
export interface PageToolbarSpec {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  titleAccessory?: ReactNode;
  segmented?: ReactNode;
  actions?: ReactNode;
  primary?: ReactNode;
}

export interface PageToolbarSnapshot {
  spec: PageToolbarSpec | null;
  registered: boolean;
}

export interface PageToolbarStore {
  register(id: string): void;
  unregister(id: string): void;
  set(id: string, spec: PageToolbarSpec | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PageToolbarSnapshot;
}

const EMPTY: PageToolbarSnapshot = { spec: null, registered: false };

/**
 * An external store, not React state: pages write their spec on every commit and only
 * PageToolbar subscribes (useSyncExternalStore), so AppLayout never re-renders because a
 * page did. Entries live in insertion order; the LAST inserted live entry is shown, and
 * `set` on an existing id keeps its position, so a re-rendering layout never steals the
 * slot from a child that mounted after it.
 */
export function createPageToolbarStore(): PageToolbarStore {
  const entries = new Map<string, PageToolbarSpec | null>();
  const listeners = new Set<() => void>();
  let snapshot: PageToolbarSnapshot = EMPTY;

  const recompute = () => {
    if (entries.size === 0) {
      snapshot = EMPTY;
    } else {
      const last = Array.from(entries.values())[entries.size - 1];
      snapshot = { spec: last, registered: true };
    }
    listeners.forEach((l) => l());
  };

  return {
    register(id) {
      if (entries.has(id)) return;
      entries.set(id, null);
      if (import.meta.env.DEV && entries.size > 1) {
        console.warn(
          '[PageToolbar] two pages registered at once; the last mounted wins. Children of a registering layout must not register.',
        );
      }
      recompute();
    },
    unregister(id) {
      if (!entries.delete(id)) return;
      recompute();
    },
    set(id, spec) {
      if (!entries.has(id)) return;
      entries.set(id, spec);
      recompute();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

interface PageToolbarContextValue {
  store: PageToolbarStore;
  vidroShell: boolean;
}

const PageToolbarContext = createContext<PageToolbarContextValue | null>(null);

export function PageToolbarProvider({
  vidroShell,
  children,
}: {
  vidroShell: boolean;
  children: ReactNode;
}) {
  const storeRef = useRef<PageToolbarStore | null>(null);
  if (!storeRef.current) storeRef.current = createPageToolbarStore();
  const value = useMemo(
    () => ({ store: storeRef.current as PageToolbarStore, vidroShell }),
    [vidroShell],
  );
  return <PageToolbarContext.Provider value={value}>{children}</PageToolbarContext.Provider>;
}

/**
 * Registers the calling page's toolbar content. Call it above every early return (pass null
 * while there is nothing to show). Returns true when the Vidro toolbar is showing it, in which
 * case the page must not render its own in-page header.
 */
export function usePageToolbar(spec: PageToolbarSpec | null): boolean {
  const ctx = useContext(PageToolbarContext);
  const id = useId();
  const store = ctx?.store ?? null;

  useLayoutEffect(() => {
    if (!store) return;
    store.register(id);
    return () => store.unregister(id);
  }, [store, id]);

  // Deliberately no deps: the latest JSX lands on every commit.
  useLayoutEffect(() => {
    store?.set(id, spec);
  });

  return ctx?.vidroShell ?? false;
}

/** For children of a registering layout (Cliente hub pages): heading level decisions only. */
export function useVidroShell(): boolean {
  return useContext(PageToolbarContext)?.vidroShell ?? false;
}

export function usePageToolbarStore(): PageToolbarStore | null {
  return useContext(PageToolbarContext)?.store ?? null;
}
