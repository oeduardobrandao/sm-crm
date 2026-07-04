// Bridge protocol v1 — HOST side (docs/estudio-v2-editor-contract.md). The forked
// OpenPencil editor runs in an iframe and talks to this window over postMessage; this
// module is the pure, testable half of the shell (EstudioPage owns React state + DOM).
// Messages are `{ v: 1, type, ...payload }`, accepted ONLY from the editor origin.

export const BRIDGE_V = 1;

export type EditorEvent =
  | { type: 'ready' }
  | { type: 'doc:loaded'; rev: number }
  | { type: 'save:ok'; rev: number; bytes: number }
  | { type: 'save:conflict'; rev: number }
  | { type: 'save:error'; message: string }
  | { type: 'auth:needed' }
  | { type: 'dirty'; dirty: boolean };

const EDITOR_EVENT_TYPES = new Set<EditorEvent['type']>([
  'ready',
  'doc:loaded',
  'save:ok',
  'save:conflict',
  'save:error',
  'auth:needed',
  'dirty',
]);

export interface EmbedHostOptions {
  editorOrigin: string;
  /** Resolve the current Supabase access token; `forceRefresh` after the editor saw a 401. */
  getAccessToken: (forceRefresh: boolean) => Promise<string | null>;
  /** postMessage into the iframe (contentWindow may not exist yet — caller guards). */
  postToEditor: (msg: Record<string, unknown>, targetOrigin: string) => void;
  onEvent: (ev: EditorEvent) => void;
  onAuthError?: (err: unknown) => void;
}

export interface EmbedHost {
  handleMessage: (e: MessageEvent) => void;
  /** Ask the editor to save immediately (autosave is 3s-debounced). */
  forceSave: () => void;
  /** Send (or re-send) the access token; the first one unblocks the editor's boot. */
  sendAuth: (forceRefresh?: boolean) => Promise<void>;
}

export function createEmbedHost(opts: EmbedHostOptions): EmbedHost {
  const post = (msg: Record<string, unknown>) =>
    opts.postToEditor({ v: BRIDGE_V, ...msg }, opts.editorOrigin);

  async function sendAuth(forceRefresh = false): Promise<void> {
    try {
      const token = await opts.getAccessToken(forceRefresh);
      if (token) post({ type: 'auth', accessToken: token });
    } catch (err) {
      opts.onAuthError?.(err);
    }
  }

  function handleMessage(e: MessageEvent): void {
    if (e.origin !== opts.editorOrigin) return;
    const d = e.data as { v?: number; type?: string } | null;
    if (!d || d.v !== BRIDGE_V || typeof d.type !== 'string') return;
    if (!EDITOR_EVENT_TYPES.has(d.type as EditorEvent['type'])) return;
    // The auth handshake is protocol plumbing the page shouldn't re-implement; events are
    // still forwarded so it can drive UI state (e.g. `ready` clears the boot-timeout hint).
    if (d.type === 'ready') void sendAuth(false);
    else if (d.type === 'auth:needed') void sendAuth(true);
    opts.onEvent(d as EditorEvent);
  }

  return { handleMessage, forceSave: () => post({ type: 'save' }), sendAuth };
}

/** Frozen editor URL shape: {EDITOR_ORIGIN}/?embed=1&docUrl=…&parentOrigin=… */
export function buildEditorUrl(editorOrigin: string, docUrl: string, parentOrigin: string): string {
  return `${editorOrigin}/?embed=1&docUrl=${encodeURIComponent(docUrl)}&parentOrigin=${encodeURIComponent(parentOrigin)}`;
}

/**
 * Where the editor fetches/saves the .fig blob. In dev the editor's origin
 * (localhost:1420) is not in prod ALLOWED_ORIGINS, so the doc route goes through the
 * CRM Vite proxy (`/estudio-fn/*`, see apps/crm/vite.config.ts) which rewrites CORS.
 */
export function buildDocUrl(
  postId: number,
  env: { dev: boolean; appOrigin: string; supabaseUrl: string },
): string {
  const base = env.dev ? `${env.appOrigin}/estudio-fn` : `${env.supabaseUrl}/functions/v1`;
  return `${base}/post-design-manage/blob?post_id=${postId}`;
}
