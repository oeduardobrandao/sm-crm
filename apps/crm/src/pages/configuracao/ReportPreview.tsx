import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CoverBlock } from '@mesaas/report-blocks/blocks/CoverBlock';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import { resolveReportTheme } from '@mesaas/report-blocks/theme';
import type { ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';

interface ReportPreviewProps {
  accentColor: string;
  splashUrl: string | null;
  logoUrl: string | null;
  workspaceName: string;
}

// Cover renders at its real (rem-based) size, meant for the ~880px editor
// canvas; NATURAL_WIDTH/SCALE shrink it into the settings sidebar via CSS
// transform (rem doesn't respond to an ancestor's font-size, only to the
// root's) while keeping every size/spacing proportion identical to the
// genuine block. Height is measured, not assumed: min-height:80vh in
// styles.css means the unscaled box is tall even with little content.
const NATURAL_WIDTH = 520;
const PREVIEW_WIDTH = 240;
const SCALE = PREVIEW_WIDTH / NATURAL_WIDTH;

const PREVIEW_BLOCK: ReportBlock = { id: 'settings-preview-cover', type: 'cover', size: 'full' };
const PREVIEW_LAYOUT: ReportLayout = { version: 1, blocks: [PREVIEW_BLOCK] };

/**
 * Live miniature of the report-blocks cover (packages/report-blocks/blocks/
 * CoverBlock.tsx) — the SAME component the editor, Hub viewer and PDF render,
 * scaled down. Renders it directly instead of hand-copying its markup so this
 * preview can never drift from the real cover again (it already had once,
 * still showing a 21:9 splash crop after the cover moved to 1:1 square).
 */
export function ReportPreview({
  accentColor,
  splashUrl,
  logoUrl,
  workspaceName,
}: ReportPreviewProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(0);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setNaturalHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const snapshot = useMemo(
    () =>
      makeSnapshotFixture({
        account: { handle: 'seucliente', specialty: '' },
        branding: {
          workspace_name: workspaceName,
          logo_url: logoUrl,
          splash_url: splashUrl,
          accent_color: accentColor,
        },
      }),
    [accentColor, splashUrl, logoUrl, workspaceName],
  );
  const theme = useMemo(() => resolveReportTheme(PREVIEW_LAYOUT, snapshot), [snapshot]);

  return (
    <div
      style={{
        width: PREVIEW_WIDTH,
        height: naturalHeight ? naturalHeight * SCALE : undefined,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
      }}
    >
      <div
        ref={innerRef}
        style={
          {
            width: NATURAL_WIDTH,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            ...theme.vars,
          } as CSSProperties
        }
      >
        <CoverBlock block={PREVIEW_BLOCK} snapshot={snapshot} />
      </div>
    </div>
  );
}
