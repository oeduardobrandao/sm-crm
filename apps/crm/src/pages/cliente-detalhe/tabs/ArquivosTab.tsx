import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FolderOpen, ExternalLink, Folder, FileImage, FileVideo, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { getFolderContents } from '@/services/fileService';
import { getFileDownloadUrl } from '@/services/fileService';
import { FileGrid, formatBytes } from '@/pages/arquivos/components/FileGrid';
import type { FileRecord } from '@/pages/arquivos/types';
import { PostMediaLightbox } from '@/pages/entregas/components/PostMediaLightbox';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { openExternalUrl } from '@/utils/security';
import type { PostMedia } from '@/store';
import { PhoneEmptyCard } from '../phone/PhoneRows';
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

  const isPhone = !useIsDesktop(768);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  useOverlayHistoryEntry(lightboxIndex !== null, () => setLightboxIndex(null));

  if (isPhone) {
    const mediaFiles = files.filter((f) => f.kind === 'image' || f.kind === 'video');
    // Same open behaviour as ArquivosPage.handleFileAction: media in the lightbox,
    // documents in a new tab (signed download URL when the row has none).
    const openFile = (file: FileRecord) => {
      if (file.kind === 'image' || file.kind === 'video') {
        const idx = mediaFiles.findIndex((f) => f.id === file.id);
        if (idx >= 0) setLightboxIndex(idx);
      } else if (file.url) {
        openExternalUrl(file.url);
      } else {
        getFileDownloadUrl(file.id)
          .then((url) => openExternalUrl(url))
          .catch(() => toast.error('Erro ao abrir arquivo'));
      }
    };
    return (
      <div id="sec-arquivos">
        {isLoading ? (
          <SkeletonStatus>
            <div className="phone-kit phone-group">
              <ul className="phone-group__list">
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="phone-cell">
                    <div className="phone-cell__main">
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </SkeletonStatus>
        ) : files.length === 0 && subfolders.length === 0 ? (
          <PhoneEmptyCard title={t('detail.noFiles')} />
        ) : (
          <>
            {subfolders.length > 0 && (
              <GroupedList header="Pastas" className="phone-cli-wrap">
                {subfolders.map((f) => (
                  <Cell
                    key={f.id}
                    label={f.name}
                    icon={<Folder />}
                    iconColor="var(--phone-fill)"
                    onClick={() => navigate('/arquivos')}
                  />
                ))}
              </GroupedList>
            )}
            {files.length > 0 && (
              <GroupedList header={t('detail.files')} className="phone-cli-wrap">
                {files.map((f) => (
                  <Cell
                    key={f.id}
                    label={f.name}
                    subtitle={formatBytes(f.size_bytes)}
                    icon={
                      f.kind === 'image' ? (
                        <FileImage />
                      ) : f.kind === 'video' ? (
                        <FileVideo />
                      ) : (
                        <FileText />
                      )
                    }
                    iconColor="var(--phone-fill)"
                    chevron={false}
                    onClick={() => openFile(f)}
                  />
                ))}
              </GroupedList>
            )}
          </>
        )}
        {folderId && (
          <GroupedList>
            <Cell
              label={
                totalFiles > 12
                  ? t('detail.viewMoreFiles', { count: totalFiles - 12 })
                  : t('detail.viewAll')
              }
              to="/arquivos"
            />
          </GroupedList>
        )}
        {lightboxIndex !== null && (
          <PostMediaLightbox
            media={mediaFiles.map(toLightboxMedia)}
            initialIndex={lightboxIndex}
            open
            onOpenChange={(open) => {
              if (!open) setLightboxIndex(null);
            }}
          />
        )}
      </div>
    );
  }

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
        <SkeletonStatus>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex flex-col rounded-lg border border-[var(--border-color)] overflow-hidden"
              >
                <Skeleton className="w-full aspect-square !rounded-none" />
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonStatus>
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

/** The lightbox reads PostMedia; same mapping as ArquivosPage's `lightboxMedia`. */
function toLightboxMedia(f: FileRecord): PostMedia {
  return {
    id: f.id,
    post_id: 0,
    conta_id: f.conta_id,
    r2_key: f.r2_key,
    thumbnail_r2_key: f.thumbnail_r2_key,
    kind: f.kind as 'image' | 'video',
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    original_filename: f.name,
    width: f.width,
    height: f.height,
    duration_seconds: f.duration_seconds,
    is_cover: false,
    sort_order: 0,
    uploaded_by: f.uploaded_by,
    created_at: f.created_at,
    blur_data_url: f.blur_data_url,
    url: f.url,
    thumbnail_url: f.thumbnail_url,
    media_lost_at: f.media_lost_at ?? null,
    playback: f.playback ?? null,
  };
}
