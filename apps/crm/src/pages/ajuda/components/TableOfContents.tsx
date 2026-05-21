import { useEffect, useState } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

function extractToc(content: Record<string, unknown> | null): TocItem[] {
  if (!content || !Array.isArray((content as { content?: unknown[] }).content)) return [];
  const items: TocItem[] = [];
  for (const node of (content as { content: { type: string; attrs?: { level?: number }; content?: { text?: string }[] }[] }).content) {
    if (node.type === 'heading' && node.attrs?.level && node.content?.length) {
      const text = node.content.map(c => c.text ?? '').join('');
      if (text.trim()) {
        const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        items.push({ id, text, level: node.attrs.level });
      }
    }
  }
  return items;
}

interface TableOfContentsProps {
  content: Record<string, unknown> | null;
}

export function TableOfContents({ content }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = extractToc(content);

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav className="hidden xl:block sticky top-24 w-56 shrink-0">
      <h4 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-light)]">
        Neste artigo
      </h4>
      <ul className="space-y-1">
        {items.map(item => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`block rounded-md px-2 py-1 text-[0.78rem] transition-colors ${
                item.level === 3 ? 'pl-4' : ''
              } ${
                activeId === item.id
                  ? 'text-[var(--primary-color)] font-medium bg-[rgba(234,179,8,0.06)]'
                  : 'text-[var(--text-light)] hover:text-[var(--text-main)]'
              }`}
              onClick={e => {
                e.preventDefault();
                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
