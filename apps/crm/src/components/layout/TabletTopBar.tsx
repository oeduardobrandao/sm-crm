import { useTranslation } from 'react-i18next';

interface TabletTopBarProps {
  onHamburgerClick: () => void;
  drawerOpen: boolean;
}

export default function TabletTopBar({ onHamburgerClick, drawerOpen }: TabletTopBarProps) {
  const { t } = useTranslation('shell');
  return (
    <div className="tablet-top-bar">
      <img
        src="/logo-black.svg"
        className="tablet-top-bar-logo logo-light"
        alt={t('topbar.logoAlt')}
      />
      <img
        src="/logo-white.svg"
        className="tablet-top-bar-logo logo-dark"
        alt={t('topbar.logoAlt')}
      />
      <button
        className="tablet-hamburger"
        onClick={onHamburgerClick}
        aria-label={drawerOpen ? t('mobileNav.closeMenu') : t('mobileNav.openMenu')}
        aria-expanded={drawerOpen}
        aria-controls="sidebar"
      >
        <i className={`ph ${drawerOpen ? 'ph-x' : 'ph-list'}`} style={{ fontSize: '1.4rem' }} />
      </button>
    </div>
  );
}
