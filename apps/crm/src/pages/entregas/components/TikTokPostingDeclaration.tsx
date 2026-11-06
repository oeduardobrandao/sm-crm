import type { ReactNode } from 'react';
import { Music2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

// Spec 2026-10-08-tiktok-audit-readiness A3. Rendered directly above every control that sends
// a TikTok post. `brandedContent === undefined` (caller has no settings) renders the branded
// variant: over-disclosing is compliant, under-disclosing is not.

export const MUSIC_USAGE_CONFIRMATION_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** The `brandedContent` prop for a post's saved `tiktok_settings`: no settings yet ->
 * `undefined` (renders the branded variant), otherwise whether brand_content_toggle is on. */
export function declarationBrandedFlag(settings: unknown): boolean | undefined {
  if (settings == null) return undefined;
  return (settings as { brand_content_toggle?: boolean }).brand_content_toggle === true;
}

function PolicyLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: 'var(--text-main)' }}
    >
      {children}
    </a>
  );
}

export function TikTokPostingDeclaration({
  brandedContent,
  className,
}: {
  brandedContent: boolean | undefined;
  className?: string;
}) {
  const { t } = useTranslation('posts');
  const branded = brandedContent !== false;
  return (
    <p
      className={`text-xs flex items-start gap-1.5 ${className ?? ''}`}
      style={{ color: 'var(--text-muted)' }}
      data-testid="tiktok-posting-declaration"
    >
      <Music2 aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <span>
        <Trans
          t={t}
          i18nKey={branded ? 'tiktokDeclaration.withBrandedContent' : 'tiktokDeclaration.musicOnly'}
          components={{
            branded: <PolicyLink href={BRANDED_CONTENT_POLICY_URL} />,
            music: <PolicyLink href={MUSIC_USAGE_CONFIRMATION_URL} />,
          }}
        />
      </span>
    </p>
  );
}
