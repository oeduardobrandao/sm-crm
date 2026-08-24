import type { BlockProps } from '../BlockRenderer';

export function DividerBlock(_props: BlockProps) {
  return (
    <hr
      className="rb-page-break"
      style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '0.5rem 0' }}
    />
  );
}
