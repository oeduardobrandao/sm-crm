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
/** Whether the entitled workspace renders as a horizontal wordmark. Callers use
 * this to drop their own adjacent name label -- with wordmark style the mark
 * itself carries the name (as image or styled text), so repeating it beside the
 * mark would duplicate the identity. */
export function isWordmarkStyle(bootstrap: {
  hub_theme?: { customized: boolean; logo_style: string } | null;
}): boolean {
  const ht = bootstrap.hub_theme;
  return (ht?.customized ?? false) && ht?.logo_style === 'wordmark';
}

export function WorkspaceMark({ size = 36 }: { size?: number }) {
  const { bootstrap, theme } = useHub();
  const { logo_url: logoUrl, name } = bootstrap.workspace;
  const ht = bootstrap.hub_theme;
  // Defense in depth, same gating as HubShell: customized: false reads
  // logo_dark_url/logo_style as their neutral defaults (null/'round'), even if a
  // stale/tampered payload carries contrary values.
  const isCustomized = ht?.customized ?? false;
  const darkUrl = isCustomized ? (ht?.logo_dark_url ?? null) : null;
  const chosenUrl = theme === 'dark' && darkUrl ? darkUrl : logoUrl;
  const isWordmark = isCustomized && ht?.logo_style === 'wordmark';

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

  // Wordmark style with no usable image: the workspace name itself is the
  // horizontal mark, set in the display font. A monogram circle here would make
  // the 'Horizontal' choice look identical to 'Redondo' until a logo is uploaded.
  if (isWordmark) {
    return (
      <span
        style={{ fontSize: Math.round(size * 0.5), maxWidth: 5 * size }}
        className="font-display font-semibold tracking-tight truncate flex-shrink-0 hub-txt"
      >
        {name.trim()}
      </span>
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
