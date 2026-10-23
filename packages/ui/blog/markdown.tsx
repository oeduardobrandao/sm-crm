/** Markdown rendering for blog posts, shared by the CRM article page, its
 * static prerender mirror and the Admin preview, so all three draw a body the
 * same way. Relative imports only (prerender import graph) and CSS-free: the
 * consumer imports `blog-render.css` itself, after its own blog stylesheet.
 *
 * IMPORTANT: render through `<BlogMarkdown>`, or pass
 * `urlTransform={blogUrlTransform}` next to `blogMarkdownComponents(post)`.
 * react-markdown's default transform blanks the `img:<key>` scheme before any
 * component runs, so without it every body image silently disappears. */
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Infografico } from './Infografico';
import type { BlogImage, BlogSource } from './model';
import { PostFigure } from './PostFigure';
import { isExternalHref, safeHref } from './safe-href';

export interface BlogRenderPost {
  images?: BlogImage[] | null;
  sources?: BlogSource[] | null;
}

const IMG_REF = /^img:([a-z0-9-]{1,40})$/;

/** Keeps `img:<key>` in an image `src`; everything else goes through
 * react-markdown's default transform (a second net under `safeHref`). */
export function blogUrlTransform(url: string, key: string): string {
  if (key === 'src' && IMG_REF.test(url)) return url;
  return defaultUrlTransform(url);
}

/** The slice of a hast node the overrides look at. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Element children only: mdast-util-to-hast puts '\n' text nodes between
 * block children, so a raw `children.length` never says "only child". */
function elementChildren(node: HastNode | undefined): HastNode[] {
  return (node?.children ?? []).filter((child) => child.type === 'element');
}

function hasText(node: HastNode | undefined): boolean {
  return (node?.children ?? []).some((child) => child.type === 'text' && !!child.value?.trim());
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function isInfograficoCode(node: HastNode): boolean {
  const className = node.properties?.className;
  return (
    node.tagName === 'code' &&
    Array.isArray(className) &&
    className.includes('language-infografico')
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function blogMarkdownComponents(post: BlogRenderPost): Components {
  const images = post.images ?? [];
  const sources = post.sources ?? [];

  return {
    // `node` is the hast AST node, not a DOM attribute: every override pulls
    // it out so it never serializes as node="[object Object]".
    a({ href, children, node: _node, ...props }) {
      const safe = safeHref(href);
      return (
        <a
          {...props}
          href={safe}
          {...(isExternalHref(safe) ? { rel: 'nofollow noopener', target: '_blank' } : {})}
        >
          {children}
        </a>
      );
    },

    // Only images from the post's own `images`, by key. A plain URL or an
    // unknown key renders nothing (draft-time validation rejects both).
    img({ src }) {
      const match = typeof src === 'string' ? IMG_REF.exec(src) : null;
      const image = match ? images.find((item) => item.key === match[1]) : undefined;
      return image ? <PostFigure image={image} /> : null;
    },

    // A paragraph holding only an image would wrap the <figure> in a <p>.
    p({ children, node, ...props }) {
      const kids = elementChildren(node as HastNode | undefined);
      if (kids.length === 1 && kids[0].tagName === 'img' && !hasText(node as HastNode)) {
        return <>{children}</>;
      }
      return <p {...props}>{children}</p>;
    },

    blockquote({ children, node, ...props }) {
      const kids = elementChildren(node as HastNode | undefined);
      const pull = kids.length === 1 && kids[0].tagName === 'p';
      return (
        <blockquote {...props} className={pull ? 'blog-pullquote' : props.className}>
          {children}
        </blockquote>
      );
    },

    // Fenced ```infografico blocks become the infographic instead of a <pre>.
    // Invalid JSON hands Infografico `undefined`, which renders nothing.
    pre({ children, node, ...props }) {
      const kids = elementChildren(node as HastNode | undefined);
      if (kids.length === 1 && isInfograficoCode(kids[0])) {
        return <Infografico data={parseJson(textOf(kids[0]))} sources={sources} />;
      }
      return <pre {...props}>{children}</pre>;
    },
  };
}

/** The whole pipeline: GFM, the blog overrides and the `img:` transform. */
export function BlogMarkdown({ post, body }: { post: BlogRenderPost; body: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={blogMarkdownComponents(post)}
      urlTransform={blogUrlTransform}
    >
      {body}
    </Markdown>
  );
}
