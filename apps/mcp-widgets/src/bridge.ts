// The one place that talks to the host (Claude, ChatGPT) through ext-apps' App.
// Cards only see the `Host` interface, so tests and dev.tsx pass a fake.
import { useSyncExternalStore } from 'react';
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';

export interface ToolCallResult {
  structuredContent?: unknown;
  isError?: boolean;
  content?: unknown[];
  _meta?: Record<string, unknown>;
}

export interface PickedImage {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface Host {
  data: unknown;
  meta: Record<string, unknown> | undefined;
  theme: 'light' | 'dark';
  callTool(name: string, args: object): Promise<ToolCallResult>;
  sendMessage(text: string): Promise<void>;
  openLink(url: string): Promise<void>;
  /** Text of an initial tool result that came back as an error (no card to draw). */
  resultError?: string;
  /** ChatGPT only (window.openai file picker); undefined on hosts without it. */
  pickImage?: () => Promise<PickedImage | null>;
  /** ChatGPT only: a fresh temporary download URL for a chat file (the one in the tool input
   *  expires). Null when the host could not give one. */
  refreshImageUrl?: (fileId: string) => Promise<string | null>;
}

interface Snapshot {
  data: unknown;
  meta: Record<string, unknown> | undefined;
  theme: 'light' | 'dark';
  resultError?: string;
}

/** First text block of a tool result, unwrapping the server's `{"error": "..."}` JSON. */
export function resultText(content: unknown[] | undefined): string | undefined {
  const first = content?.find(
    (c): c is { type: 'text'; text: string } =>
      !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text',
  );
  if (!first) return undefined;
  try {
    const parsed = JSON.parse(first.text) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).error === 'string') {
      return (parsed as any).error;
    }
  } catch {
    // plain-text summary
  }
  return first.text;
}

function themeOf(ctx: McpUiHostContext | undefined): 'light' | 'dark' {
  if (ctx?.theme === 'dark' || ctx?.theme === 'light') return ctx.theme;
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

// ChatGPT's widget globals. Shapes are read defensively: only the two calls the
// attach card needs, feature-detected, never assumed on other hosts.
interface OpenAiGlobals {
  selectFiles?: (opts?: unknown) => Promise<unknown>;
  getFileDownloadUrl?: (arg: unknown) => Promise<unknown>;
}

/** getFileDownloadUrl answers `{ downloadUrl }`; older shapes are read too. */
function downloadUrlOf(res: unknown): string | null {
  const r = res as Record<string, unknown> | null;
  const url = typeof res === 'string' ? res : (r?.downloadUrl ?? r?.download_url ?? r?.url);
  return typeof url === 'string' && url ? url : null;
}

function openAiRefresh(): Host['refreshImageUrl'] {
  const oa = (globalThis as { openai?: OpenAiGlobals }).openai;
  if (typeof oa?.getFileDownloadUrl !== 'function') return undefined;
  return async (fileId) => {
    try {
      return downloadUrlOf(await oa.getFileDownloadUrl!({ fileId }));
    } catch {
      return null;
    }
  };
}

function openAiPicker(): Host['pickImage'] {
  const oa = (globalThis as { openai?: OpenAiGlobals }).openai;
  if (typeof oa?.selectFiles !== 'function' || typeof oa?.getFileDownloadUrl !== 'function') {
    return undefined;
  }
  return async () => {
    const picked = await oa.selectFiles!({ accept: ['image/png', 'image/jpeg'], multiple: false });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const f = list[0] as Record<string, unknown> | undefined;
    const fileId = (f?.fileId ?? f?.file_id ?? f?.id) as string | undefined;
    if (!fileId) return null;
    const url = downloadUrlOf(await oa.getFileDownloadUrl!({ fileId }));
    if (!url) return null;
    const mime = (f?.mimeType ?? f?.mime_type) as string | undefined;
    return { download_url: url, file_id: fileId, ...(mime ? { mime_type: mime } : {}) };
  };
}

class HostStore {
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  readonly app: App;

  constructor() {
    this.snap = { data: undefined, meta: undefined, theme: themeOf(undefined) };
    this.app = new App({ name: 'mesaas-cards', version: '1.0.0' }, {}, { autoResize: true });
    // One-shot events: register before connect() or the host's first push is lost.
    this.app.addEventListener('toolresult', (r) => {
      this.set({
        data: r.isError ? undefined : r.structuredContent,
        meta: r._meta as Record<string, unknown> | undefined,
        resultError: r.isError ? (resultText(r.content) ?? '') : undefined,
      });
    });
    this.app.addEventListener('hostcontextchanged', () => this.applyContext());
    this.app
      .connect(new PostMessageTransport(window.parent, window.parent))
      .then(() => this.applyContext())
      .catch((e) => console.error('[mesaas-cards] connect failed', e));
  }

  private applyContext() {
    const ctx = this.app.getHostContext();
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    const theme = themeOf(ctx);
    // color-scheme on the document must match the host's, or Chromium paints the iframe's
    // canvas opaque behind the card. Sets data-theme + color-scheme on <html>.
    applyDocumentTheme(theme);
    this.set({ theme });
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snap;
}

let store: HostStore | undefined;
let actions:
  | Pick<Host, 'callTool' | 'sendMessage' | 'openLink' | 'pickImage' | 'refreshImageUrl'>
  | undefined;

function getStore(): HostStore {
  if (!store) {
    const s = new HostStore();
    store = s;
    actions = {
      async callTool(name, args) {
        const r = await s.app.callServerTool({
          name,
          arguments: args as Record<string, unknown>,
        });
        return {
          structuredContent: r.structuredContent,
          isError: r.isError,
          content: r.content,
          _meta: r._meta as Record<string, unknown> | undefined,
        };
      },
      async sendMessage(text) {
        const r = await s.app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
        if (r.isError) throw new Error('message_rejected');
      },
      async openLink(url) {
        const r = await s.app.openLink({ url });
        if (r.isError) throw new Error('link_rejected');
      },
      pickImage: openAiPicker(),
      refreshImageUrl: openAiRefresh(),
    };
  }
  return store;
}

export function useHost(): Host {
  const s = getStore();
  const snap = useSyncExternalStore(s.subscribe, s.getSnapshot);
  return { ...snap, ...actions! };
}
