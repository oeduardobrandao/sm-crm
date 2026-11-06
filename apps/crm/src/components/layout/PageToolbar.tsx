import { useSyncExternalStore, type ReactNode } from 'react';
import { usePageToolbarStore, type PageToolbarSnapshot } from './PageToolbarContext';

const NONE: PageToolbarSnapshot = { spec: null, registered: false };
const noopSubscribe = () => () => {};
const noneSnapshot = () => NONE;

/** The Vidro panel's first row: page title on the left, page actions and the shell capsule on the right. */
export default function PageToolbar({ capsule }: { capsule: ReactNode }) {
  const store = usePageToolbarStore();
  const { spec } = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : noneSnapshot,
    noneSnapshot,
  );

  return (
    <header className="vidro-toolbar">
      <div className="vidro-toolbar-left">
        {spec?.leading}
        {spec?.subtitleBelow ? (
          <div className="vidro-toolbar-heading">
            <div className="vidro-toolbar-heading-row">
              {spec.title != null && <h1 className="vidro-toolbar-title">{spec.title}</h1>}
              {spec.titleAccessory}
            </div>
            {spec.subtitle != null && <div className="vidro-toolbar-subtitle">{spec.subtitle}</div>}
          </div>
        ) : (
          <>
            {spec?.title != null && <h1 className="vidro-toolbar-title">{spec.title}</h1>}
            {spec?.titleAccessory}
            {spec?.subtitle != null && (
              <div className="vidro-toolbar-subtitle">{spec.subtitle}</div>
            )}
          </>
        )}
      </div>
      <div className="vidro-toolbar-right">
        {spec?.segmented}
        {/* Actions, capsule and primary wrap as one group, so a narrow toolbar breaks after the
            segmented control instead of orphaning the primary button on a row of its own. */}
        <div className="vidro-toolbar-end">
          {spec?.actions}
          {capsule}
          {spec?.primary}
        </div>
      </div>
    </header>
  );
}
