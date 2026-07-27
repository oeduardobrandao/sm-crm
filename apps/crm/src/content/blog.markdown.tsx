/** Component overrides shared by the static mirror (build) and the article
 * page (client), so both render markdown identically. Relative imports only:
 * this module is in the prerender import graph, and it must stay CSS-free. */
import type { Components } from 'react-markdown';

/** External links get rel="nofollow noopener" (we link to competitors) and
 * open in a new tab; internal links stay plain so the SPA router is free to
 * handle them later. */
export const MARKDOWN_COMPONENTS: Components = {
  // `node` is react-markdown's hast AST node, not a DOM attribute — pull it
  // out so it never gets spread onto the rendered <a> (it would otherwise
  // serialize as node="[object Object]" on every link).
  a({ href, children, node: _node, ...props }) {
    const external = !!href && !href.startsWith('/') && !href.startsWith('#');
    return (
      <a
        href={href}
        {...(external ? { rel: 'nofollow noopener', target: '_blank' } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
};
