export type MentionEntityType = 'membro' | 'post' | 'cliente' | 'tarefa';

export interface MentionRef {
  entityType: MentionEntityType;
  id: number;
  label: string;
  parentId?: number | null;
}
