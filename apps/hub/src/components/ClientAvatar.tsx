import { useState } from 'react';

/**
 * The client's photo — a manually-uploaded one if the agency set one,
 * otherwise their connected Instagram avatar, the same image the CRM shows
 * on the client detail page. Falls back to the initial when neither exists,
 * and also when the image fails to load: the avatar is served from a public
 * bucket, but a stale row can still point at an expired CDN url, and a
 * broken-image glyph next to the client's own name reads worse than a
 * monogram.
 */
export function ClientAvatar({
  name,
  photoUrl,
  size = 28,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase();
  const box = { width: size, height: size };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        role="img"
        style={box}
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0 border hub-border"
      />
    );
  }

  // Sized proportionally so the fallback initial still reads at any size —
  // the 28px nav avatar and the 128px homepage one need very different font
  // sizes; a fixed 11px looked fine at 28px and lost in a 128px circle.
  const fontSize = Math.max(11, Math.round(size * 0.4));

  return (
    <div
      style={{ ...box, fontSize }}
      aria-hidden="true"
      className="rounded-full flex items-center justify-center flex-shrink-0 font-semibold hub-bg-soft hub-tx2 border hub-border"
    >
      {initial}
    </div>
  );
}
