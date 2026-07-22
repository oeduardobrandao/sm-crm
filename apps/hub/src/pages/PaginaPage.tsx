import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHub } from '../HubContext';
import { fetchPage } from '../api';
import type { HubContentBlock } from '../types';
import { sanitizeExternalUrl } from '../lib/security';

const markdownComponents = {
  h1: (props: React.ComponentProps<'h1'>) => (
    <h1
      {...props}
      className="font-display text-[1.875rem] font-semibold tracking-tight hub-txt mt-10 mb-3"
    />
  ),
  h2: (props: React.ComponentProps<'h2'>) => (
    <h2
      {...props}
      className="font-display text-[1.5rem] font-semibold tracking-tight hub-txt mt-8 mb-2.5"
    />
  ),
  h3: (props: React.ComponentProps<'h3'>) => (
    <h3
      {...props}
      className="font-display text-[1.25rem] font-semibold tracking-tight hub-txt mt-6 mb-2"
    />
  ),
  p: (props: React.ComponentProps<'p'>) => (
    <p {...props} className="text-[15px] hub-tx2 leading-relaxed mb-4" />
  ),
  a: (props: React.ComponentProps<'a'>) => (
    <a
      {...props}
      href={sanitizeExternalUrl(props.href)}
      target="_blank"
      rel="noopener noreferrer"
      className="hub-txt font-medium underline decoration-[var(--hub-txt)] decoration-2 underline-offset-4 hover:decoration-[var(--hub-txt)] transition-colors"
    />
  ),
  img: (props: React.ComponentProps<'img'>) => (
    <img
      {...props}
      src={sanitizeExternalUrl(props.src)}
      className="rounded-xl max-w-full my-5 border hub-border"
    />
  ),
  ul: (props: React.ComponentProps<'ul'>) => (
    <ul {...props} className="list-disc pl-6 mb-4 text-[15px] hub-tx2 leading-relaxed" />
  ),
  ol: (props: React.ComponentProps<'ol'>) => (
    <ol {...props} className="list-decimal pl-6 mb-4 text-[15px] hub-tx2 leading-relaxed" />
  ),
  li: (props: React.ComponentProps<'li'>) => <li {...props} className="mb-1" />,
  blockquote: (props: React.ComponentProps<'blockquote'>) => (
    <blockquote {...props} className="border-l-4 hub-border-strong pl-4 my-4 hub-tx2 italic" />
  ),
  code: ({
    className,
    children,
    ...props
  }: React.ComponentProps<'code'> & { inline?: boolean }) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <code
        {...props}
        className={`${className ?? ''} block hub-bg-soft rounded-lg p-4 my-4 text-sm hub-txt overflow-x-auto`}
      >
        {children}
      </code>
    ) : (
      <code {...props} className="hub-bg-soft rounded px-1.5 py-0.5 text-sm hub-txt">
        {children}
      </code>
    );
  },
  pre: (props: React.ComponentProps<'pre'>) => (
    <pre {...props} className="hub-bg-soft rounded-lg p-4 my-4 text-sm hub-txt overflow-x-auto" />
  ),
  hr: (props: React.ComponentProps<'hr'>) => <hr {...props} className="my-8 hub-border" />,
  table: (props: React.ComponentProps<'table'>) => (
    <div className="overflow-x-auto my-4">
      <table {...props} className="w-full text-[15px] hub-tx2 border-collapse" />
    </div>
  ),
  th: (props: React.ComponentProps<'th'>) => (
    <th
      {...props}
      className="border hub-border px-3 py-2 hub-bg-soft font-semibold text-left hub-txt"
    />
  ),
  td: (props: React.ComponentProps<'td'>) => (
    <td {...props} className="border hub-border px-3 py-2" />
  ),
};

function renderBlock(block: HubContentBlock, i: number) {
  switch (block.type) {
    case 'heading':
      if (block.level === 1)
        return (
          <h1
            key={i}
            className="font-display text-[1.875rem] font-semibold tracking-tight hub-txt mt-10 mb-3"
          >
            {block.content}
          </h1>
        );
      if (block.level === 2)
        return (
          <h2
            key={i}
            className="font-display text-[1.5rem] font-semibold tracking-tight hub-txt mt-8 mb-2.5"
          >
            {block.content}
          </h2>
        );
      return (
        <h3
          key={i}
          className="font-display text-[1.25rem] font-semibold tracking-tight hub-txt mt-6 mb-2"
        >
          {block.content}
        </h3>
      );
    case 'image':
      return (
        <img
          key={i}
          src={sanitizeExternalUrl(block.content)}
          alt=""
          className="rounded-xl max-w-full my-5 border hub-border"
        />
      );
    case 'link':
      return (
        <a
          key={i}
          href={sanitizeExternalUrl(block.href)}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-txt font-medium underline decoration-[var(--hub-txt)] decoration-2 underline-offset-4 hover:decoration-[var(--hub-txt)] transition-colors"
        >
          {block.content}
        </a>
      );
    case 'markdown':
      return (
        <div key={i} className="hub-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {block.content}
          </ReactMarkdown>
        </div>
      );
    default:
      return (
        <p key={i} className="text-[15px] hub-tx2 leading-relaxed mb-4 whitespace-pre-wrap">
          {block.content}
        </p>
      );
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

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  const page = data?.page;
  if (!page) return <div className="max-w-3xl mx-auto py-8 hub-tx2">Página não encontrada.</div>;

  return (
    <article className="max-w-3xl mx-auto hub-fade-up">
      <Link
        to={`${base}/paginas`}
        className="hub-back-link inline-flex items-center gap-1.5 text-[13px] hub-tx3 mb-8 group transition-colors"
      >
        <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" /> Voltar
      </Link>
      <h1 className="font-display text-[2.25rem] sm:text-[2.75rem] leading-[1.05] font-medium tracking-tight hub-txt mb-8">
        {page.title}
      </h1>
      <div>{page.content.map(renderBlock)}</div>
    </article>
  );
}
