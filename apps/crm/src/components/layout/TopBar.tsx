import GlobalSearchTrigger from './GlobalSearchTrigger';
import TopBarActions from './TopBarActions';
import NavigationProgress from './NavigationProgress';

interface TopBarProps {
  onHamburgerClick?: () => void;
  showHamburger?: boolean;
}

export default function TopBar({ onHamburgerClick, showHamburger }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {showHamburger && (
          <button
            type="button"
            className="topbar-action-btn"
            onClick={onHamburgerClick}
            aria-label="Menu"
          >
            <i className="ph ph-list" style={{ fontSize: '1.2rem' }} />
          </button>
        )}
        <a href="/dashboard" style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/logo-white.svg" alt="Mesaas" className="topbar-logo" />
        </a>
      </div>
      <div className="topbar-center">
        <GlobalSearchTrigger />
      </div>
      <div className="topbar-right">
        <TopBarActions />
      </div>
      <NavigationProgress />
    </header>
  );
}
