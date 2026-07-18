import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Info,
  LayoutList,
  History,
  Instagram,
  Music2,
  FileText,
  LayoutDashboard,
  FolderOpen,
  CalendarDays,
  MapPin,
  Wallet,
  Plug,
  BarChart3,
  ExternalLink,
  Edit2,
  type LucideIcon,
} from 'lucide-react';
import type {
  NavSectionItem,
  NavActionItem,
  NavSectionKey,
  NavActionKey,
} from './clienteDetalheNav.model';

const SECTION_META: Record<NavSectionKey, { icon: LucideIcon; labelKey: string }> = {
  info: { icon: Info, labelKey: 'detail.nav.info' },
  entregas: { icon: LayoutList, labelKey: 'detail.nav.entregas' },
  historico: { icon: History, labelKey: 'detail.nav.historico' },
  instagram: { icon: Instagram, labelKey: 'detail.nav.instagram' },
  tiktok: { icon: Music2, labelKey: 'detail.nav.tiktok' },
  relatorio: { icon: FileText, labelKey: 'detail.nav.relatorio' },
  hub: { icon: LayoutDashboard, labelKey: 'detail.nav.hub' },
  arquivos: { icon: FolderOpen, labelKey: 'detail.nav.arquivos' },
  datas: { icon: CalendarDays, labelKey: 'detail.nav.datas' },
  enderecos: { icon: MapPin, labelKey: 'detail.nav.enderecos' },
  financeiro: { icon: Wallet, labelKey: 'detail.nav.financeiro' },
};

const ACTION_META: Record<NavActionKey, { icon: LucideIcon; labelKey: string }> = {
  connectInstagram: { icon: Plug, labelKey: 'detail.nav.connectInstagram' },
  analytics: { icon: BarChart3, labelKey: 'detail.nav.analytics' },
  openHub: { icon: ExternalLink, labelKey: 'detail.nav.openHub' },
  editar: { icon: Edit2, labelKey: 'detail.nav.editar' },
};

interface ClienteDetalheNavProps {
  sections: NavSectionItem[];
  actions: NavActionItem[];
}

export function ClienteDetalheNav({ sections, actions }: ClienteDetalheNavProps) {
  const { t } = useTranslation('clients');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Stable dependency: re-subscribe only when the set of section ids changes,
  // not on every render (the parent recomputes the arrays each render).
  const sectionIds = sections.map((s) => s.id).join(',');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = sectionIds ? sectionIds.split(',') : [];
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sectionIds]);

  const handleSectionClick = (id: string) => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <nav className="cliente-detalhe-nav" aria-label={t('detail.pageNav')}>
      <div className="cliente-detalhe-nav__group">
        {sections.map((s) => {
          const { icon: Icon, labelKey } = SECTION_META[s.key];
          const label = t(labelKey);
          const active = activeId === s.id;
          return (
            <button
              key={s.key}
              type="button"
              className={`cliente-detalhe-nav__item${
                active ? ' cliente-detalhe-nav__item--active' : ''
              }`}
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => handleSectionClick(s.id)}
            >
              <Icon className="cliente-detalhe-nav__icon" aria-hidden="true" />
              <span className="cliente-detalhe-nav__label">{label}</span>
            </button>
          );
        })}
      </div>
      {actions.length > 0 && <div className="cliente-detalhe-nav__divider" />}
      <div className="cliente-detalhe-nav__group">
        {actions.map((a) => {
          const { icon: Icon, labelKey } = ACTION_META[a.key];
          const label = t(labelKey);
          return (
            <button
              key={a.key}
              type="button"
              className="cliente-detalhe-nav__item cliente-detalhe-nav__item--action"
              aria-label={label}
              onClick={a.onClick}
            >
              <Icon className="cliente-detalhe-nav__icon" aria-hidden="true" />
              <span className="cliente-detalhe-nav__label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
