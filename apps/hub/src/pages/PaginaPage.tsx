import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPage } from '../api';
import type { HubContentBlock } from '../types';

function renderBlock(block: HubContentBlock, i: number) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1) return <h1 key={i} className="text-2xl font-bold mt-6 mb-2">{block.content}</h1>;
      if (block.level === 2) return <h2 key={i} className="text-xl font-semibold mt-5 mb-2">{block.content}</h2>;
      return <h3 key={i} className="text-lg font-medium mt-4 mb-1">{block.content}</h3>;
    case 'image':
      return <img key={i} src={block.content} alt="" className="rounded-xl max-w-full my-4" />;
    case 'link':
      return <a key={i} href={block.href} target="_blank" rel="noreferrer" className="text-primary underline">{block.content}</a>;
    default:
      return <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-3 whitespace-pre-wrap">{block.content}</p>;
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

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const page = data?.page;
  if (!page) return <div className="max-w-2xl mx-auto py-8 text-muted-foreground">Página não encontrada.</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link to={`${base}/paginas`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft size={15} /> Voltar
      </Link>
      <h1 className="text-2xl font-semibold mb-6">{page.title}</h1>
      <div>{page.content.map(renderBlock)}</div>
    </div>
  );
}
