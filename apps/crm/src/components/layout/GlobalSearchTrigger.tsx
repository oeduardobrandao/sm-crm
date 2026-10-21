import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import GlobalSearchDialog from './GlobalSearchDialog';

/**
 * Botão da topbar (ou da sidebar no visual Vidro) + atalho ⌘K/Ctrl+K. O conteúdo da busca vive em
 * GlobalSearchDialog.
 */
export default function GlobalSearchTrigger({
  variant = 'topbar',
  onClose,
}: {
  variant?: 'topbar' | 'sidebar';
  /** Called once each time the palette closes, whichever way it closed. */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) onClose?.();
    wasOpen.current = open;
  }, [open, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isMac = navigator.platform.toUpperCase().includes('MAC');

  return (
    <>
      <button
        type="button"
        className={variant === 'sidebar' ? 'search-trigger--sidebar' : 'search-trigger'}
        // The collapsed rail hides the text, so the sidebar button needs its own accessible name.
        aria-label={
          variant === 'sidebar' ? t('topbar.search', 'Buscar...').replace('...', '') : undefined
        }
        onClick={() => setOpen(true)}
      >
        <Search size={15} className="search-trigger-icon" />
        <span className="search-trigger-text">{t('topbar.search', 'Buscar...')}</span>
        <kbd className="search-trigger-kbd">{isMac ? '⌘' : 'Ctrl+'}K</kbd>
      </button>

      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
