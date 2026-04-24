// apps/crm/src/pages/arquivos/types.ts

export interface Folder {
  id: number;
  conta_id: string;
  parent_id: number | null;
  name: string;
  source: 'system' | 'user';
  source_type: 'client' | 'workflow' | 'post' | null;
  source_id: number | null;
  name_overridden: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  file_count?: number;
  subfolder_count?: number;
}

export interface FileRecord {
  id: number;
  conta_id: string;
  folder_id: number | null;
  r2_key: string;
  thumbnail_r2_key: string | null;
  name: string;
  kind: 'image' | 'video' | 'document';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  blur_data_url: string | null;
  uploaded_by: string | null;
  reference_count: number;
  created_at: string;
  url?: string;
  thumbnail_url?: string | null;
}

export interface PostFileLink {
  id: number;
  post_id: number;
  file_id: number;
  conta_id: string;
  is_cover: boolean;
  sort_order: number;
  created_at: string;
}

export interface FolderContents {
  folder: Folder | null;
  subfolders: Folder[];
  files: FileRecord[];
  breadcrumbs: Pick<Folder, 'id' | 'name'>[];
}
