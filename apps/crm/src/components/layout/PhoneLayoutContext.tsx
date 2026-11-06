import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What a page asks of the phone shell while it is mounted. */
export interface PhoneChromeOptions {
  /** The page renders its own `PhonePageHeader`, so the shell's bell bar steps aside. */
  pageHeader?: boolean;
  /** `false` hides the floating tab bar (e.g. a thread with a composer pinned at the bottom). */
  tabBar?: boolean;
}

interface PhoneLayoutContextValue {
  /** True below 768px inside the CRM shell (the breakpoint `AppLayout` and `MobileNav` use). */
  isPhone: boolean;
  /** Adds a chrome request under `id` (replacing an earlier one with the same id). Returns its removal. */
  register: (id: string, options: PhoneChromeOptions) => () => void;
}

const noopRegister = () => () => {};

/**
 * Outside `AppLayout` (public pages, tests that render a component alone) there is no
 * phone shell: `isPhone` is false and chrome requests do nothing. F0c gates the dialog
 * primitives on this, so dialogs rendered outside the shell keep the desktop look.
 */
export const PhoneLayoutContext = createContext<PhoneLayoutContextValue>({
  isPhone: false,
  register: noopRegister,
});

export interface PhoneChromeState {
  pageHeader: boolean;
  tabBarHidden: boolean;
}

/**
 * State behind the context, for the component that owns `.app-container` (AppLayout).
 * Requests live in a map keyed by the caller's `useId()`, so the derived flags are an
 * OR over everything currently mounted: a page and a nested screen can both ask, two
 * routes swapping in one commit never leave a stale attribute, and the last consumer
 * to unmount clears it.
 */
export function usePhoneChromeController(isPhone: boolean) {
  const [requests, setRequests] = useState<ReadonlyMap<string, PhoneChromeOptions>>(
    () => new Map(),
  );

  const register = useCallback((id: string, options: PhoneChromeOptions) => {
    setRequests((prev) => {
      const next = new Map(prev);
      next.set(id, options);
      return next;
    });
    return () => {
      setRequests((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const contextValue = useMemo(() => ({ isPhone, register }), [isPhone, register]);

  const chrome = useMemo<PhoneChromeState>(() => {
    let pageHeader = false;
    let tabBarHidden = false;
    for (const options of requests.values()) {
      if (options.pageHeader) pageHeader = true;
      if (options.tabBar === false) tabBarHidden = true;
    }
    return { pageHeader, tabBarHidden };
  }, [requests]);

  /** Spread onto `.app-container`. CSS keyed on these only acts below 768px. */
  const attributes = {
    'data-phone-page-header': chrome.pageHeader ? '' : undefined,
    'data-phone-tab-bar': chrome.tabBarHidden ? 'hidden' : undefined,
  } as const;

  return { contextValue, chrome, attributes };
}

/**
 * Provider without a container, for tests and isolated trees that need `isPhone` (e.g. a
 * dialog's phone branch). `AppLayout` uses `usePhoneChromeController` directly so the
 * attributes land on `.app-container`.
 */
export function PhoneLayoutProvider({
  isPhone,
  children,
}: {
  isPhone: boolean;
  children: ReactNode;
}) {
  const { contextValue } = usePhoneChromeController(isPhone);
  return <PhoneLayoutContext.Provider value={contextValue}>{children}</PhoneLayoutContext.Provider>;
}

/** `{ isPhone }` of the surrounding shell; `{ isPhone: false }` outside `AppLayout`. */
export function usePhoneLayout(): { isPhone: boolean } {
  const { isPhone } = useContext(PhoneLayoutContext);
  return { isPhone };
}

/**
 * Opts the current screen into phone chrome changes while it is mounted:
 * `pageHeader: true` hides the shell's bell bar (the page renders `PhonePageHeader` or
 * `PhoneNavBar` instead) and `tabBar: false` hides the floating tab bar. Registered in a
 * layout effect, so the shell bar never paints for a frame on a page that replaces it.
 * A no-op outside `AppLayout`.
 */
export function usePhoneChrome({ pageHeader = false, tabBar = true }: PhoneChromeOptions = {}) {
  const { register } = useContext(PhoneLayoutContext);
  const id = useId();
  useLayoutEffect(() => {
    if (!pageHeader && tabBar) return;
    return register(id, { pageHeader, tabBar });
  }, [register, id, pageHeader, tabBar]);
}
