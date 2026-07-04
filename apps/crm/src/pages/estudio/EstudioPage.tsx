import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { buildDocUrl, buildEditorUrl, createEmbedHost, type EditorEvent } from './embedHost';

// Estúdio v2 CRM shell — hosts the forked OpenPencil editor in an iframe and implements
// the parent side of bridge protocol v1 (docs/estudio-v2-editor-contract.md): auth
// handshake over postMessage (tokens never touch the URL), save status, conflict → reload.
// The editor loads/saves the .fig blob itself via docUrl (post-design-manage /blob).

const EDITOR_ORIGIN: string | null =
  (import.meta.env.VITE_ESTUDIO_EDITOR_ORIGIN as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:1420' : null);

/** How long a silent iframe can stay "booting" before we hint the editor isn't running. */
const BOOT_TIMEOUT_MS = 8000;

/** How long the post-`ready` doc fetch may take before the spinner gives up. */
const DOC_LOAD_TIMEOUT_MS = 20000;

type BootStatus = 'booting' | 'loading' | 'ready';
type SaveState = 'saved' | 'dirty' | 'conflict';

async function getAccessToken(forceRefresh: boolean): Promise<string | null> {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    return data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function CenteredNotice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '2rem' }}>
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: '28rem' }}>
        {children}
      </div>
    </div>
  );
}

export default function EstudioPage() {
  const { postId: postIdParam } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('estudio');
  const { features } = useWorkspaceLimits();

  const postId = postIdParam !== undefined ? parseInt(postIdParam, 10) : null;
  const estudioBlocked = features?.feature_estudio === false;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<BootStatus>('booting');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [dirty, setDirty] = useState(false);
  const [bootTimedOut, setBootTimedOut] = useState(false);
  // Non-null = the doc never loaded (boot GET failed: 403 not editable / feature off, 404,
  // 422 video media, auth timeout...). Holds the editor's detail message ('' = watchdog).
  const [loadError, setLoadError] = useState<string | null>(null);
  const statusRef = useRef<BootStatus>('booting');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const onEvent = useCallback(
    (ev: EditorEvent) => {
      switch (ev.type) {
        case 'ready':
          setStatus((s) => (s === 'booting' ? 'loading' : s));
          setBootTimedOut(false);
          break;
        case 'doc:loaded':
          setStatus('ready');
          setLoadError(null);
          break;
        case 'save:ok':
          setDirty(false);
          setSaveState((s) => (s === 'conflict' ? s : 'saved'));
          break;
        case 'dirty':
          setDirty(ev.dirty);
          setSaveState((s) => (s === 'conflict' ? s : ev.dirty ? 'dirty' : 'saved'));
          break;
        case 'save:error':
          // The editor also reports FAILED BOOTS this way (its own toast is under our
          // overlay) — before doc:loaded this must become the load-error screen, or the
          // spinner runs forever.
          if (statusRef.current !== 'ready') setLoadError(ev.message ?? '');
          else toast.error(t('editor.saveError'));
          break;
        case 'save:conflict':
          setSaveState('conflict');
          break;
        case 'auth:needed': // host re-auth handled inside embedHost
          break;
      }
    },
    [t],
  );

  const host = useMemo(
    () =>
      EDITOR_ORIGIN
        ? createEmbedHost({
            editorOrigin: EDITOR_ORIGIN,
            getAccessToken,
            postToEditor: (msg, targetOrigin) =>
              iframeRef.current?.contentWindow?.postMessage(msg, targetOrigin),
            onEvent,
            onAuthError: () => toast.error(t('editor.authError')),
          })
        : null,
    [onEvent, t],
  );

  const editorUrl = useMemo(() => {
    if (!EDITOR_ORIGIN || postId === null || isNaN(postId)) return null;
    const docUrl = buildDocUrl(postId, {
      dev: import.meta.env.DEV,
      appOrigin: window.location.origin,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
    });
    return buildEditorUrl(EDITOR_ORIGIN, docUrl, window.location.origin);
  }, [postId]);

  useEffect(() => {
    if (!host) return;
    window.addEventListener('message', host.handleMessage);
    return () => window.removeEventListener('message', host.handleMessage);
  }, [host]);

  // Long sessions: proactively hand refreshed tokens to the editor (it keeps them in memory).
  useEffect(() => {
    if (!host) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') void host.sendAuth(false);
    });
    return () => data.subscription.unsubscribe();
  }, [host]);

  // A dead iframe fails silently (no bridge `ready`) — after 8s, hint that the editor
  // service isn't up. Dev-only reality today; prod gets the editor origin at cutover.
  // Keyed on `status`: leaving 'booting' cancels the pending timer.
  useEffect(() => {
    if (!editorUrl || status !== 'booting') return;
    const timer = setTimeout(() => setBootTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [editorUrl, reloadKey, status]);

  // Watchdog for the doc-fetch phase (post-`ready`): a hung GET emits no bridge event at
  // all, so give up after 20s instead of spinning forever.
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => setLoadError((e) => e ?? ''), DOC_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, reloadKey]);

  // Dirty guards: autosave is 3s-debounced, so navigating away can drop the last edits.
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t('editor.unsavedPrompt'))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const reloadEditor = useCallback(() => {
    setStatus('booting');
    setSaveState('saved');
    setDirty(false);
    setBootTimedOut(false);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // ----- non-editor views -------------------------------------------------------------

  if (postId === null) {
    return (
      <CenteredNotice>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '2rem',
            fontWeight: 900,
            color: 'var(--text-main)',
            marginBottom: '0.5rem',
          }}
        >
          {t('title')}
        </h1>
        <p style={{ marginBottom: '1.25rem' }}>{t('openFromEntregas')}</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/entregas')}>
          {t('goToEntregas')}
        </button>
      </CenteredNotice>
    );
  }

  if (isNaN(postId)) return <CenteredNotice>{t('editor.invalidPost')}</CenteredNotice>;
  if (estudioBlocked) return <CenteredNotice>{t('featureBlocked')}</CenteredNotice>;
  if (!editorUrl) return <CenteredNotice>{t('editor.unavailable')}</CenteredNotice>;

  // ----- editor shell -----------------------------------------------------------------

  const pill = {
    saved: { label: t('editor.savePill.saved'), color: 'var(--text-light)', bg: 'transparent' },
    dirty: {
      label: t('editor.savePill.dirty'),
      color: 'var(--warning)',
      bg: 'rgba(245,163,66,0.12)',
    },
    conflict: {
      label: t('editor.savePill.conflict'),
      color: 'var(--danger)',
      bg: 'rgba(245,90,66,0.12)',
    },
  }[saveState];

  return (
    <div
      className="page-full-bleed"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--card-bg)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('back')}
          className="flex items-center justify-center rounded-md transition-colors"
          style={{ width: 32, height: 32, color: 'var(--text-muted)' }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{t('title')}</span>
        <span style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}>#{postId}</span>
        <span
          data-testid="save-pill"
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '0.25rem 0.6rem',
            borderRadius: 999,
            color: pill.color,
            background: pill.bg,
          }}
        >
          {pill.label}
        </span>
        <div style={{ flex: 1 }} />
        {dirty && saveState !== 'conflict' && (
          <button
            type="button"
            onClick={() => host?.forceSave()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors"
            style={{ background: 'rgba(234,179,8,0.12)', color: 'var(--primary-hover)' }}
          >
            <Save className="h-3.5 w-3.5" /> {t('editor.saveNow')}
          </button>
        )}
      </header>

      {saveState === 'conflict' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.5rem 1rem',
            background: 'rgba(245,90,66,0.1)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            flexShrink: 0,
          }}
        >
          <span>{t('editor.conflictBanner')}</span>
          <button
            type="button"
            onClick={reloadEditor}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md"
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            <RefreshCw className="h-3 w-3" /> {t('editor.reload')}
          </button>
        </div>
      )}

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={editorUrl}
          title={t('title')}
          allow="clipboard-read; clipboard-write"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
        {status !== 'ready' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--bg-color)',
            }}
          >
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', maxWidth: '26rem' }}>
              {loadError !== null ? (
                <>
                  <p style={{ marginBottom: '0.5rem', color: 'var(--danger)' }}>
                    {t('editor.loadError')}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                    {t('editor.loadErrorHint')}
                  </p>
                  {loadError && (
                    <p
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.7rem',
                        color: 'var(--text-light)',
                        marginTop: '0.5rem',
                      }}
                    >
                      {loadError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={reloadEditor}
                    className="btn-secondary"
                    style={{ marginTop: '1rem' }}
                  >
                    {t('editor.reload')}
                  </button>
                </>
              ) : bootTimedOut ? (
                <>
                  <p style={{ marginBottom: '0.5rem' }}>{t('editor.notRunning')}</p>
                  {import.meta.env.DEV && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                      {t('editor.notRunningDevHint')}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={reloadEditor}
                    className="btn-secondary"
                    style={{ marginTop: '1rem' }}
                  >
                    {t('editor.reload')}
                  </button>
                </>
              ) : (
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('editor.loading')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
