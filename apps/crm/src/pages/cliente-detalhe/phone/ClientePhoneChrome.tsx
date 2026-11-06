import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import './clienteDetalhePhone.css';

/* Phone chrome of /clientes/:id/* (PLAN F3.1). Every section keeps its own route and
 * renders under ONE nav bar owned by ClienteDetalhePage: back to the sections index,
 * the section's large title with the client's name under it, and a trailing slot the
 * section fills through `ClientePhoneNavActions`. A section that draws its own title
 * (Briefing's picker) or its own pushed screen (the Páginas editor) says so through
 * `useClientePhoneHeader`, so a screen never shows two nav bars. */

export interface ClientePhoneHeaderOptions {
  /** Replaces the tab label as the large title. */
  title?: string;
  /** Replaces the client's name under the title. */
  subtitle?: string;
  /** The section renders its own title block under the nav bar. */
  hideTitle?: boolean;
  /** The section shows a pushed screen with its own nav bar (nav bar and title go). */
  hideNavBar?: boolean;
}

interface ClientePhoneChromeValue {
  actionsSlot: HTMLElement | null;
  setHeader: (id: string, options: ClientePhoneHeaderOptions | null) => void;
}

const ClientePhoneChromeContext = createContext<ClientePhoneChromeValue | null>(null);

/**
 * Header options of the current section while it is mounted. Strings and booleans only,
 * so the layout effect re-runs only when they really change. A no-op outside the shell.
 */
export function useClientePhoneHeader(options: ClientePhoneHeaderOptions) {
  const ctx = useContext(ClientePhoneChromeContext);
  const id = useId();
  const setHeader = ctx?.setHeader;
  const { title, subtitle, hideTitle, hideNavBar } = options;
  useLayoutEffect(() => {
    if (!setHeader) return;
    setHeader(id, { title, subtitle, hideTitle, hideNavBar });
    return () => setHeader(id, null);
  }, [setHeader, id, title, subtitle, hideTitle, hideNavBar]);
}

/** True inside the phone section shell (the nav bar exists to carry actions). */
export function useInClientePhoneShell(): boolean {
  return useContext(ClientePhoneChromeContext) !== null;
}

/**
 * Round buttons for the shell's nav bar (Briefing "…", Páginas "+"). Rendered in place
 * when there is no shell, so a section rendered alone (tests) still shows them.
 */
export function ClientePhoneNavActions({ children }: { children: ReactNode }) {
  const ctx = useContext(ClientePhoneChromeContext);
  if (!ctx) return <div className="phone-cli-inline-actions">{children}</div>;
  if (!ctx.actionsSlot) return null;
  return createPortal(children, ctx.actionsSlot);
}

/**
 * Back from a section. A section pushed from inside this client (the index, or Acesso's
 * "O que o cliente vê" rows) pops back to it; one opened directly (deep link, reload,
 * notification, an OAuth return) is replaced by the index instead, so Back always lands
 * on the client and never on whatever page came before.
 *
 * Call it in ClienteDetalhePage, which stays mounted while the child routes change, so
 * the previous path is still known when a section renders.
 */
export function useClienteSectionBack(clienteId: number) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const lastPathRef = useRef<string | null>(null);
  const pushedFromRef = useRef<string | null>(null);

  if (lastPathRef.current !== pathname) {
    pushedFromRef.current = navigationType === 'PUSH' ? lastPathRef.current : null;
    lastPathRef.current = pathname;
  }

  const indexPath = `/clientes/${clienteId}`;
  const pushedFrom = pushedFromRef.current;
  const fromThisClient =
    pushedFrom !== null && (pushedFrom === indexPath || pushedFrom.startsWith(`${indexPath}/`));
  const fromIndex = pushedFrom === indexPath;

  const onBack = useCallback(() => {
    if (fromThisClient) navigate(-1);
    else navigate(indexPath, { replace: true });
  }, [fromThisClient, navigate, indexPath]);

  return { onBack, toIndex: fromIndex || !fromThisClient };
}

export function ClientePhoneSectionShell({
  clienteNome,
  tabLabel,
  onBack,
  backToClient,
  children,
}: {
  clienteNome: string;
  tabLabel: string;
  onBack: () => void;
  /** Back returns to the client's index (the label names the client). */
  backToClient: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [header, setHeaderState] = useState<{
    id: string;
    options: ClientePhoneHeaderOptions;
  } | null>(null);

  const setHeader = useCallback((id: string, options: ClientePhoneHeaderOptions | null) => {
    setHeaderState((prev) => {
      if (options) return { id, options };
      return prev?.id === id ? null : prev;
    });
  }, []);

  const value = useMemo(() => ({ actionsSlot, setHeader }), [actionsSlot, setHeader]);
  const options = header?.options ?? {};

  return (
    <ClientePhoneChromeContext.Provider value={value}>
      <div className="phone-cli-section">
        {!options.hideNavBar && (
          <PhoneNavBar
            backLabel={
              backToClient
                ? t('phoneChrome.backToClient', { name: clienteNome })
                : tc('actions.back')
            }
            onBack={onBack}
            trailing={<span ref={setActionsSlot} className="phone-cli-nav-actions" />}
          />
        )}
        {!options.hideNavBar && !options.hideTitle && (
          <header className="phone-kit phone-large-title phone-cli-title">
            <h1 className="phone-large-title__title">{options.title ?? tabLabel}</h1>
            <p className="phone-large-title__subtitle">{options.subtitle ?? clienteNome}</p>
          </header>
        )}
        {children}
      </div>
    </ClientePhoneChromeContext.Provider>
  );
}
