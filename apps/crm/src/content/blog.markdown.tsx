/** Compatibility shim: the blog's markdown overrides now live in
 * packages/ui/blog/markdown.tsx, shared with the Admin preview. Relative
 * imports only: this module is in the prerender import graph.
 *
 * `MARKDOWN_COMPONENTS` has no images or sources, so `img:` figures and
 * infographic captions need `blogMarkdownComponents(post)` plus
 * `blogUrlTransform` (or `<BlogMarkdown>`). */
import { blogMarkdownComponents } from '../../../../packages/ui/blog/markdown';

export {
  BlogMarkdown,
  blogMarkdownComponents,
  blogUrlTransform,
} from '../../../../packages/ui/blog/markdown';

export const MARKDOWN_COMPONENTS = blogMarkdownComponents({ images: [] });
