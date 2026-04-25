import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { Folder as FolderIcon, FileImage, FileVideo, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
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
  if (kind === 'image') return 'Imagem';
  if (kind === 'video') return 'Vídeo';
  return 'Documento';
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
      <span className="text-sm text-[var(--text-main)] text-right font-mono">
        {value}
      </span>
    </div>
  );
}

function FolderInfoContent({ folder }: { folder: Folder }) {
  const { data: info, isLoading } = useQuery({
    queryKey: ['folder-info', folder.id],
    queryFn: () => getFolderInfo(folder.id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  const sourceLabel =
    folder.source_type === 'client'
      ? 'Cliente'
      : folder.source_type === 'workflow'
        ? 'Workflow'
        : folder.source_type === 'post'
          ? 'Postagem'
          : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 mb-4">
        <FolderIcon className="h-8 w-8 text-[var(--primary-color)] flex-shrink-0" />
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-[var(--text-main)] truncate" style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}>
            {folder.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {folder.source === 'system' && (
              <span className="text-[0.6rem] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                AUTO
              </span>
            )}
            {folder.source === 'system' && sourceLabel && (
              <span className="text-xs text-[var(--text-muted)]">
                Vinculado a: {sourceLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <InfoRow
        label="Criada em"
        value={format(new Date(folder.created_at), "dd 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR })}
      />
      {info && (
        <>
          <InfoRow label="Tamanho total" value={formatBytes(info.total_size_bytes)} />
          <InfoRow label="Arquivos (total)" value={String(info.total_file_count)} />
          <InfoRow label="Subpastas diretas" value={String(info.direct_subfolder_count)} />
          <InfoRow label="Arquivos diretos" value={String(info.direct_file_count)} />
        </>
      )}
    </div>
  );
}

function FileInfoContent({ file }: { file: FileRecord }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 mb-4">
        <FileKindIcon kind={file.kind} className="h-8 w-8 text-[var(--text-muted)] flex-shrink-0" />
        <h3 className="text-lg font-bold text-[var(--text-main)] truncate" style={{ fontFamily: 'var(--font-heading, "Playfair Display", serif)' }}>
          {file.name}
        </h3>
      </div>

      <InfoRow label="Tipo" value={kindLabel(file.kind)} />
      <InfoRow label="MIME" value={file.mime_type} />
      <InfoRow label="Tamanho" value={formatBytes(file.size_bytes)} />
      {(file.width != null && file.height != null) && (
        <InfoRow label="Dimensões" value={`${file.width} × ${file.height}`} />
      )}
      {file.duration_seconds != null && (
        <InfoRow label="Duração" value={formatDuration(file.duration_seconds)} />
      )}
      <InfoRow
        label="Enviado em"
        value={format(new Date(file.created_at), "dd 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR })}
      />
      <InfoRow label="Links em posts" value={String(file.reference_count)} />
    </div>
  );
}

export function FolderInfoModal({ open, onOpenChange, item, type }: FolderInfoModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Informações</DialogTitle>
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
