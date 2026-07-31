import { useEffect, useState } from 'react';
import { useHub } from '../HubContext';

/**
 * The agency's logo, shown beside the workspace name wherever that name appears
 * — sidebar, mobile top bar, mobile drawer. Falls back to the initial when the
 * workspace has no logo, and also when the image fails to load: logo_url is
 * operator-supplied and can rot, and a broken-image glyph beside the agency's
 * own name is worse than a monogram.
 *
 * When brand customization supplies a dark-mode logo, dark mode swaps to it;
 * otherwise it keeps using the light logo in both modes (unchanged behavior).
 * `logo_style: 'wordmark'` renders the image at its natural aspect ratio instead
 * of cropping it into a circle — 'round' (and any unrecognized value) keeps
 * today's exact circular rendering.
 */
export function WorkspaceMark({ size = 36 }: { size?: number }) {
  const { bootstrap, theme } = useHub();
  const { logo_url: logoUrl, name } = bootstrap.workspace;
  const ht = bootstrap.hub_theme;
  const darkUrl = ht?.logo_dark_url ?? null;
  const chosenUrl = theme === 'dark' && darkUrl ? darkUrl : logoUrl;
  const isWordmark = ht?.logo_style === 'wordmark';

  const [failed, setFailed] = useState(false);
  // The broken-image flag is per-URL: if the dark logo 404s but the light one
  // works (or vice versa), switching modes must retry the new URL instead of
  // being stuck showing the monogram from the previous mode's failure.
  useEffect(() => {
    setFailed(false);
  }, [chosenUrl]);

  const box = { width: size, height: size };

  if (chosenUrl && !failed) {
    if (isWordmark) {
      return (
        <img
          src={chosenUrl}
          alt={name}
          style={{ height: size, width: 'auto', maxWidth: 3.5 * size, objectFit: 'contain' }}
          onError={() => setFailed(true)}
          className="rounded-md flex-shrink-0"
        />
      );
    }
    return (
      <img
        src={chosenUrl}
        alt={name}
        style={box}
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div
      style={{ ...box, fontSize: Math.round(size * 0.44) }}
      aria-hidden="true"
      className="rounded-full flex items-center justify-center font-display font-semibold flex-shrink-0 hub-btn-primary"
    >
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}
