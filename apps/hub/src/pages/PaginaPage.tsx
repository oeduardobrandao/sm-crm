import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPage } from '../api';
import type { HubContentBlock } from '../types';

function renderBlock(block: HubContentBlock, i: number) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) return <h1 key={i} className="font-display text-[1.875rem] font-semibold tracking-tight text-stone-900 mt-10 mb-3">{block.content}</h1>;
      if (block.level === 2) return <h2 key={i} className="font-display text-[1.5rem] font-semibold tracking-tight text-stone-900 mt-8 mb-2.5">{block.content}</h2>;
      return <h3 key={i} className="font-display text-[1.25rem] font-semibold tracking-tight text-stone-900 mt-6 mb-2">{block.content}</h3>;
    case 'image':
      return <img key={i} src={block.content} alt="" className="rounded-2xl max-w-full my-5 border border-stone-200/80" />;
    case 'link':
      return <a key={i} href={block.href} target="_blank" rel="noreferrer" className="text-stone-900 font-medium underline decoration-[#FFBF30] decoration-2 underline-offset-4 hover:decoration-stone-900 transition-colors">{block.content}</a>;
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
