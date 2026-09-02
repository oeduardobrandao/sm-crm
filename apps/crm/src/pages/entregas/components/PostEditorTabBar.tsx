import type { ReactNode } from 'react';
import { FileText, Image as ImageIcon, ListChecks, Send, MessageSquare } from 'lucide-react';

export type PostEditorTab = 'conteudo' | 'midia' | 'propriedades' | 'publicacao' | 'comentarios';

interface PostEditorTabBarProps {
  active: PostEditorTab;
  onChange: (tab: PostEditorTab) => void;
  /** Badge da aba Mídia. Omitido/0 = sem badge. */
  mediaCount?: number;
  /** Badge da aba Comentários (threads abertas). Omitido/0 = sem badge. */
  commentCount?: number;
  /** Post avulso não tem propriedades de template: a aba some inteira. */
  showProperties: boolean;
  /** Ponto âmbar em Conteúdo (sugestão do cliente pendente). */
  contentAttention?: boolean;
  /** Ponto vermelho em Publicação (falha de publicação). */
  publishAttention?: boolean;
}

interface TabDef {
  key: PostEditorTab;
  label: string;
  icon: ReactNode;
  badge?: number;
  dot?: 'warning' | 'danger';
}

export function PostEditorTabBar({
  active,
  onChange,
  mediaCount,
  commentCount,
  showProperties,
  contentAttention,
  publishAttention,
}: PostEditorTabBarProps) {
  const tabs: TabDef[] = [
    {
      key: 'conteudo',
      label: 'Conteúdo',
      icon: <FileText className="h-3.5 w-3.5" />,
      dot: contentAttention ? 'warning' : undefined,
    },
    { key: 'midia', label: 'Mídia', icon: <ImageIcon className="h-3.5 w-3.5" />, badge: mediaCount },
    ...(showProperties
      ? [
          {
            key: 'propriedades',
            label: 'Propriedades',
            icon: <ListChecks className="h-3.5 w-3.5" />,
          } satisfies TabDef,
        ]
      : []),
    {
      key: 'publicacao',
      label: 'Publicação',
      icon: <Send className="h-3.5 w-3.5" />,
      dot: publishAttention ? 'danger' : undefined,
    },
    {
      key: 'comentarios',
      label: 'Comentários',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      badge: commentCount,
    },
  ];

  return (
    <div className="drawer-post-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`drawer-post-tab${active === t.key ? ' drawer-post-tab--active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.icon}
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className="drawer-post-tab-badge">{t.badge}</span>
          )}
          {t.dot && <span className={`drawer-post-tab-dot drawer-post-tab-dot--${t.dot}`} />}
        </button>
      ))}
    </div>
  );
}
