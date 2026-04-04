interface TabletTopBarProps {
  onHamburgerClick: () => void;
  drawerOpen: boolean;
}

export default function TabletTopBar({ onHamburgerClick, drawerOpen }: TabletTopBarProps) {
  return (
    <div className="tablet-top-bar">
      <img src="/logo-black.svg" className="tablet-top-bar-logo logo-light" alt="Logo" />
      <img src="/logo-white.svg" className="tablet-top-bar-logo logo-dark" alt="Logo" />
      <button
        className="tablet-hamburger"
        onClick={onHamburgerClick}
        aria-label={drawerOpen ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={drawerOpen}
        aria-controls="sidebar"
      >
        <i className={`ph ${drawerOpen ? 'ph-x' : 'ph-list'}`} style={{ fontSize: '1.4rem' }} />
      </button>
    </div>
  );
}
