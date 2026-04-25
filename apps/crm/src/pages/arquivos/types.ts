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
  total_size_bytes?: number;
  has_children?: boolean;
  _optimistic?: boolean;
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
  _uploading?: boolean;
  _progress?: number;
  _localPreviewUrl?: string;
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
  storage?: { used_bytes: number; quota_bytes: number };
}

export interface FolderInfo extends Folder {
  total_size_bytes: number;
  total_file_count: number;
  direct_subfolder_count: number;
  direct_file_count: number;
}
