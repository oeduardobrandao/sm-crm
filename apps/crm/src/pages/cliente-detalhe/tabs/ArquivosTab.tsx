import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderOpen, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/spinner';
import { getFolderContents } from '@/services/fileService';
import { FileGrid } from '@/pages/arquivos/components/FileGrid';
import { useAuth } from '@/context/AuthContext';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

/**
 * "Arquivos" tab: `ClienteArquivosSection` ported verbatim out of the
 * pre-split ClienteDetalhePage (see git history at d30adeea) — a preview of
 * the client's root folder in Arquivos, capped at 12 items, with a
 * "Ver todos"/"Ver mais" affordance that has always just navigated to the
 * standalone /arquivos page rather than paginating in place. This
 * extraction keeps that behavior exactly as it was.
 *
 * The `folders` lookup below intentionally does NOT check `error` on the
 * `.single()` call: "no folder yet" and a genuine RLS/network failure both
 * fall through to the same empty state today. That is existing behavior
 * carried over unchanged — not something this task fixes.
 */
export default function ArquivosTab() {
  const { clienteId } = useOutletContext<ClienteDetalheOutletContext>();
  const { t } = useTranslation('clients');
  const navigate = useNavigate();
  const { can } = useAuth();
  // FileContextMenu's Renomear/Excluir call services/fileService directly
  // (rename/delete a file or folder for real), independent of this preview
  // widget's own onFileAction/onActionComplete no-ops -- so this tiny
  // 12-item preview is a real mutation surface too, not just a read-only
  // shortcut to /arquivos. Same gate as the standalone ArquivosPage.tsx.
  const canEditFiles = can('arquivos', 'editar') === true;

  const { data: folderData } = useQuery({
    queryKey: ['client-folder', clienteId],
    queryFn: async () => {
      const { data } = await supabase
        .from('folders')
        .select('id')
        .eq('source_type', 'client')
        .eq('source_id', clienteId)
        .single();
      return data;
    },
  });

  const folderId = folderData?.id ?? null;

  const { data: contents, isLoading } = useQuery({
    queryKey: ['folder-contents', folderId],
    queryFn: () => getFolderContents(folderId),
    enabled: folderId !== null,
  });

  const files = (contents?.files ?? []).slice(0, 12);
  const subfolders = contents?.subfolders ?? [];
  const totalFiles = contents?.files?.length ?? 0;

  return (
    <div id="sec-arquivos" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
          <FolderOpen className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
          {t('detail.files')}
        </h3>
        {folderId && (
          <button
            onClick={() => navigate('/arquivos')}
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            {t('detail.viewAll')} <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : files.length === 0 && subfolders.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-4">{t('detail.noFiles')}</p>
      ) : (
        <>
          <FileGrid
            files={files}
            subfolders={subfolders}
            onOpenFolder={() => navigate('/arquivos')}
            onFileAction={() => {}}
            onActionComplete={() => {}}
            viewMode="grid"
            canEdit={canEditFiles}
          />
          {totalFiles > 12 && (
            <button
              onClick={() => navigate('/arquivos')}
              className="mt-3 text-sm text-[var(--primary-color)] hover:underline"
            >
              {t('detail.viewMoreFiles', { count: totalFiles - 12 })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
