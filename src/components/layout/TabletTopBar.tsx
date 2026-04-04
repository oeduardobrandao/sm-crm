interface TabletTopBarProps {
  onHamburgerClick: () => void;
}

export default function TabletTopBar({ onHamburgerClick }: TabletTopBarProps) {
  return (
    <div className="tablet-top-bar">
      <img src="/logo-black.svg" className="tablet-top-bar-logo logo-light" alt="Logo" />
      <img src="/logo-white.svg" className="tablet-top-bar-logo logo-dark" alt="Logo" />
      <button
        className="tablet-hamburger"
        onClick={onHamburgerClick}
        aria-label="Abrir menu"
        aria-expanded={false}
      >
        <i className="ph ph-list" style={{ fontSize: '1.4rem' }} />
      </button>
    </div>
  );
}
