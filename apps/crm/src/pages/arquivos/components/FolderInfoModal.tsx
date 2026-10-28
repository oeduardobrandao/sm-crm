import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { i18n, useDateFnsLocale } from '@mesaas/i18n';
import { Folder as FolderIcon, FileImage, FileVideo, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { getFolderInfo } from '@/services/fileService';
import { formatBytes } from './FileGrid';
import type { Folder, FileRecord } from '../types';

interface FolderInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Folder | FileRecord;
  type: 'folder' | 'file';
}

function FileKindIcon({ kind, className }: { kind: FileRecord['kind']; className?: string }) {
  if (kind === 'image') return <FileImage className={className} />;
  if (kind === 'video') return <FileVideo className={className} />;
  return <FileText className={className} />;
}

function kindLabel(kind: FileRecord['kind']): string {
  if (kind === 'image') return i18n.t('files:shared.kind.image');
  if (kind === 'video') return i18n.t('files:shared.kind.video');
  return i18n.t('files:shared.kind.document');
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-[var(--border-color)] last:border-b-0">
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-[var(--text-main)] text-right font-mono">{value}</span>
    </div>
  );
}

function FolderInfoContent({ folder }: { folder: Folder }) {
  const { t } = useTranslation('files');
  const dateLocale = useDateFnsLocale();
  const { data: info, isLoading } = useQuery({
    queryKey: ['folder-info', folder.id],
    queryFn: () => getFolderInfo(folder.id),
  });

  if (isLoading) {
    return (
      <SkeletonStatus className="space-y-1">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="h-8 w-8 shrink-0" />
          <Skeleton className="h-5 w-40" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 py-2 border-b border-[var(--border-color)] last:border-b-0"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </SkeletonStatus>
    );
  }

  const sourceLabel =
    folder.source_type === 'client'
      ? t('folderInfoModal.source.client')
      : folder.source_type === 'workflow'
        ? t('folderInfoModal.source.workflow')
        : folder.source_type === 'post'
          ? t('folderInfoModal.source.post')
          : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 mb-4">
        <FolderIcon className="h-8 w-8 text-[var(--primary-color)] flex-shrink-0" />
        <div className="min-w-0">
          <h3
            className="text-lg font-bold text-[var(--text-main)] truncate"
            style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}
          >
            {folder.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {folder.source === 'system' && (
              <span className="text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                {t('shared.autoBadge')}
              </span>
            )}
            {folder.source === 'system' && sourceLabel && (
              <span className="text-xs text-[var(--text-muted)]">
                {t('folderInfoModal.linkedTo', { source: sourceLabel })}
              </span>
            )}
          </div>
        </div>
      </div>

      <InfoRow
        label={t('folderInfoModal.createdAt')}
        value={format(new Date(folder.created_at), t('shared.dateTimeFormat'), {
          locale: dateLocale,
        })}
      />
      {info && (
        <>
          <InfoRow
            label={t('folderInfoModal.totalSize')}
            value={formatBytes(info.total_size_bytes)}
          />
          <InfoRow label={t('folderInfoModal.totalFiles')} value={String(info.total_file_count)} />
          <InfoRow
            label={t('folderInfoModal.directSubfolders')}
            value={String(info.direct_subfolder_count)}
          />
          <InfoRow
            label={t('folderInfoModal.directFiles')}
            value={String(info.direct_file_count)}
          />
        </>
      )}
    </div>
  );
}

function FileInfoContent({ file }: { file: FileRecord }) {
  const { t } = useTranslation('files');
  const dateLocale = useDateFnsLocale();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 mb-4">
        <FileKindIcon kind={file.kind} className="h-8 w-8 text-[var(--text-muted)] flex-shrink-0" />
        <h3
          className="text-lg font-bold text-[var(--text-main)] truncate"
          style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}
        >
          {file.name}
        </h3>
      </div>

      <InfoRow label={t('folderInfoModal.type')} value={kindLabel(file.kind)} />
      <InfoRow label={t('folderInfoModal.mime')} value={file.mime_type} />
      <InfoRow label={t('folderInfoModal.size')} value={formatBytes(file.size_bytes)} />
      {file.width != null && file.height != null && (
        <InfoRow label={t('folderInfoModal.dimensions')} value={`${file.width} × ${file.height}`} />
      )}
      {file.duration_seconds != null && (
        <InfoRow
          label={t('folderInfoModal.duration')}
          value={formatDuration(file.duration_seconds)}
        />
      )}
      <InfoRow
        label={t('folderInfoModal.uploadedAt')}
        value={format(new Date(file.created_at), t('shared.dateTimeFormat'), {
          locale: dateLocale,
        })}
      />
      <InfoRow label={t('folderInfoModal.inUse')} value={String(file.reference_count)} />
    </div>
  );
}

export function FolderInfoModal({ open, onOpenChange, item, type }: FolderInfoModalProps) {
  const { t } = useTranslation('files');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('folderInfoModal.title')}</DialogTitle>
        </DialogHeader>
        {type === 'folder' ? (
          <FolderInfoContent folder={item as Folder} />
        ) : (
          <FileInfoContent file={item as FileRecord} />
        )}
      </DialogContent>
    </Dialog>
  );
}
