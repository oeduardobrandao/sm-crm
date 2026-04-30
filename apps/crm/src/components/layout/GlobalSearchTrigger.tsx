import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
} from '@/components/ui/command';

export default function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
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
        className="search-trigger"
        onClick={() => setOpen(true)}
      >
        <Search size={15} className="search-trigger-icon" />
        <span className="search-trigger-text">{t('topbar.search', 'Buscar...')}</span>
        <kbd className="search-trigger-kbd">{isMac ? '⌘' : 'Ctrl+'}K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('topbar.searchPlaceholder', 'Buscar...')} />
        <CommandList>
          <CommandEmpty>{t('topbar.noResults', 'Nenhum resultado.')}</CommandEmpty>
        </CommandList>
      </CommandDialog>
    </>
  );
}
