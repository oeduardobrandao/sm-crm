// One app, five card kinds, switched on structuredContent.card (spec §6).
import { Component, type ReactNode } from 'react';
import type { Host } from './bridge';
import type { CardData } from './types';
import { errorMessage } from './ui';
import { PostPreview } from './cards/PostPreview';
import { CaptionOptions } from './cards/CaptionOptions';
import { ClientCalendar } from './cards/ClientCalendar';
import { AttachImage } from './cards/AttachImage';
import { SendResult } from './cards/SendFlow';
import { Fallback, Loading, ResultError } from './cards/Fallback';

const KNOWN = new Set([
  'post_preview',
  'caption_options',
  'client_calendar',
  'attach_image',
  'send_result',
]);

function asCard(data: unknown): CardData | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as { card?: unknown; v?: unknown };
  return typeof d.card === 'string' && KNOWN.has(d.card) && d.v === 1
    ? (data as CardData)
    : undefined;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[mesaas-cards] render failed', e);
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

function CardSwitch({ host }: { host: Host }) {
  if (host.resultError !== undefined) {
    return (
      <ResultError
        message={errorMessage({ content: [{ type: 'text', text: host.resultError }] })}
      />
    );
  }
  if (host.data === undefined) return <Loading />;
  const card = asCard(host.data);
  if (!card) return <Fallback />;
  switch (card.card) {
    case 'post_preview':
      return <PostPreview host={host} data={card} />;
    case 'caption_options':
      return <CaptionOptions host={host} data={card} />;
    case 'client_calendar':
      return <ClientCalendar host={host} data={card} />;
    case 'attach_image':
      return <AttachImage host={host} data={card} />;
    case 'send_result':
      return <SendResult host={host} data={card} />;
  }
}

export function App({ host }: { host: Host }) {
  return (
    <div className="mw-root" data-theme={host.theme}>
      <Boundary>
        <CardSwitch host={host} />
      </Boundary>
    </div>
  );
}
