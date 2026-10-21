// Snapshot de exemplo para o editor e a prévia de modelos: números fictícios
// (makeSnapshotFixture) com a marca real do workspace, mesmo racional de
// ReportPreview.tsx.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import { getCurrentWorkspace, getWorkspaceBranding } from '../../store';

export function useSampleSnapshot() {
  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
  });
  const { data: branding } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
  });
  return useMemo(
    () =>
      makeSnapshotFixture({
        account: { handle: 'seucliente', specialty: '' },
        branding: {
          workspace_name: workspace?.name ?? '',
          logo_url: workspace?.logo_url ?? null,
          splash_url: branding?.report_splash_url ?? null,
          accent_color: branding?.brand_color ?? '#eab308',
        },
      }),
    [workspace, branding],
  );
}
