import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHub } from '../HubContext';
import { fetchPage } from '../api';
import type { HubContentBlock } from '../types';

const markdownComponents = {
  h1: (props: React.ComponentProps<'h1'>) => <h1 {...props} className="font-display text-[1.875rem] font-semibold tracking-tight text-stone-900 mt-10 mb-3" />,
  h2: (props: React.ComponentProps<'h2'>) => <h2 {...props} className="font-display text-[1.5rem] font-semibold tracking-tight text-stone-900 mt-8 mb-2.5" />,
  h3: (props: React.ComponentProps<'h3'>) => <h3 {...props} className="font-display text-[1.25rem] font-semibold tracking-tight text-stone-900 mt-6 mb-2" />,
  p: (props: React.ComponentProps<'p'>) => <p {...props} className="text-[15px] text-stone-700 leading-relaxed mb-4" />,
  a: (props: React.ComponentProps<'a'>) => <a {...props} target="_blank" rel="noreferrer" className="text-stone-900 font-medium underline decoration-[#FFBF30] decoration-2 underline-offset-4 hover:decoration-stone-900 transition-colors" />,
  img: (props: React.ComponentProps<'img'>) => <img {...props} className="rounded-xl max-w-full my-5 border border-stone-200/80" />,
  ul: (props: React.ComponentProps<'ul'>) => <ul {...props} className="list-disc pl-6 mb-4 text-[15px] text-stone-700 leading-relaxed" />,
  ol: (props: React.ComponentProps<'ol'>) => <ol {...props} className="list-decimal pl-6 mb-4 text-[15px] text-stone-700 leading-relaxed" />,
  li: (props: React.ComponentProps<'li'>) => <li {...props} className="mb-1" />,
  blockquote: (props: React.ComponentProps<'blockquote'>) => <blockquote {...props} className="border-l-4 border-stone-300 pl-4 my-4 text-stone-600 italic" />,
  code: ({ className, children, ...props }: React.ComponentProps<'code'> & { inline?: boolean }) => {
    const isBlock = className?.includes('language-');
    return isBlock
      ? <code {...props} className={`${className ?? ''} block bg-stone-100 rounded-lg p-4 my-4 text-sm text-stone-800 overflow-x-auto`}>{children}</code>
      : <code {...props} className="bg-stone-100 rounded px-1.5 py-0.5 text-sm text-stone-800">{children}</code>;
  },
  pre: (props: React.ComponentProps<'pre'>) => <pre {...props} className="bg-stone-100 rounded-lg p-4 my-4 text-sm text-stone-800 overflow-x-auto" />,
  hr: (props: React.ComponentProps<'hr'>) => <hr {...props} className="my-8 border-stone-200" />,
  table: (props: React.ComponentProps<'table'>) => <div className="overflow-x-auto my-4"><table {...props} className="w-full text-[15px] text-stone-700 border-collapse" /></div>,
  th: (props: React.ComponentProps<'th'>) => <th {...props} className="border border-stone-200 px-3 py-2 bg-stone-50 font-semibold text-left text-stone-900" />,
  td: (props: React.ComponentProps<'td'>) => <td {...props} className="border border-stone-200 px-3 py-2" />,
};

function renderBlock(block: HubContentBlock, i: number) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) return <h1 key={i} className="font-display text-[1.875rem] font-semibold tracking-tight text-stone-900 mt-10 mb-3">{block.content}</h1>;
      if (block.level === 2) return <h2 key={i} className="font-display text-[1.5rem] font-semibold tracking-tight text-stone-900 mt-8 mb-2.5">{block.content}</h2>;
      return <h3 key={i} className="font-display text-[1.25rem] font-semibold tracking-tight text-stone-900 mt-6 mb-2">{block.content}</h3>;
    case 'image':
      return <img key={i} src={block.content} alt="" className="rounded-xl max-w-full my-5 border border-stone-200/80" />;
    case 'link':
      return <a key={i} href={block.href} target="_blank" rel="noreferrer" className="text-stone-900 font-medium underline decoration-[#FFBF30] decoration-2 underline-offset-4 hover:decoration-stone-900 transition-colors">{block.content}</a>;
    case 'markdown':
      return <div key={i} className="hub-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{block.content}</ReactMarkdown></div>;
    default:
      return <p key={i} className="text-[15px] text-stone-700 leading-relaxed mb-4 whitespace-pre-wrap">{block.content}</p>;
  }
}

export function PaginaPage() {
  const { token, workspace } = useHub();
  const { pageId } = useParams<{ pageId: string }>();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-page', token, pageId],
    queryFn: () => fetchPage(token, pageId!),
    enabled: !!pageId,
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" /></div>;

  const page = data?.page;
  if (!page) return <div className="max-w-3xl mx-auto py-8 text-stone-500">Página não encontrada.</div>;

  return (
    <article className="max-w-3xl mx-auto hub-fade-up">
      <Link to={`${base}/paginas`} className="inline-flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-900 mb-8 group transition-colors">
        <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" /> Voltar
      </Link>
      <h1 className="font-display text-[2.25rem] sm:text-[2.75rem] leading-[1.05] font-medium tracking-tight text-stone-900 mb-8">{page.title}</h1>
      <div>{page.content.map(renderBlock)}</div>
    </article>
  );
}
