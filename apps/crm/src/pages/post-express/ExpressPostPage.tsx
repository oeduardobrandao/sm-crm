import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Send, AlertCircle, Image, Film, Images, Layers, Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrerequisiteAlert } from '@/components/help/PrerequisiteAlert';
import { EmptyStateGuide } from '@/components/help/EmptyStateGuide';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase';
import {
  getClientes,
  addWorkflow,
  addWorkflowEtapa,
  addWorkflowPost,
  updateWorkflowPost,
  updateWorkflow,
  removeWorkflow,
  getHubToken,
  type PostMedia,
} from '../../store';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { publishInstagramPostNow } from '../../services/instagram';
import { PostMediaGallery } from '../entregas/components/PostMediaGallery';

interface DraftState {
  workflowId: number;
  postId: number;
}

interface IgAccount {
  id: number;
  username: string | null;
  profile_picture_url: string | null;
  authorization_status: string;
  token_expires_at: string | null;
  permissions: string[] | null;
}

function detectPostType(media: PostMedia[]): 'feed' | 'reels' | 'carrossel' | null {
  if (media.length === 0) return null;
  if (media.length > 1) return 'carrossel';
  if (media[0].kind === 'video') return 'reels';
  return 'feed';
}

function getTypeLabel(
  type: 'feed' | 'reels' | 'carrossel' | 'stories',
  t: (key: string) => string,
): { label: string; color: string; bg: string; icon: typeof Image } {
  switch (type) {
    case 'feed':
      return {
        label: t('postType.feed'),
        color: '#eab308',
        bg: 'rgba(234,179,8,0.12)',
        icon: Image,
      };
    case 'reels':
      return {
        label: t('postType.reels'),
        color: '#E1306C',
        bg: 'rgba(225,48,108,0.12)',
        icon: Film,
      };
    case 'carrossel':
      return {
        label: t('postType.carrossel'),
        color: '#42c8f5',
        bg: 'rgba(66,200,245,0.12)',
        icon: Images,
      };
    case 'stories':
      return {
        label: t('postType.stories'),
        color: '#E1306C',
        bg: 'rgba(225,48,108,0.12)',
        icon: Layers,
      };
  }
}

const MAX_CAPTION = 2200;

const STEP_CARD_STYLE: CSSProperties = {
  background: 'var(--card-bg)',
  borderRadius: '8px',
  padding: '1.25rem',
  border: '1px solid var(--border-color)',
  marginBottom: '14px',
  minWidth: 0,
};

function StepIndicator({
  state,
  number,
  isLast,
}: {
  state: 'done' | 'active' | 'todo';
  number: number;
  isLast?: boolean;
}) {
  const circleStyle: CSSProperties =
    state === 'done'
      ? { background: 'rgba(62,207,142,0.15)', color: '#3ecf8e' }
      : state === 'active'
        ? { background: 'var(--cta-bg)', color: 'var(--cta-fg)' }
        : {
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
          };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.8rem',
          fontWeight: 700,
          ...circleStyle,
        }}
      >
        {state === 'done' ? <Check className="h-4 w-4" /> : number}
      </div>
      {!isLast && (
        <div style={{ flex: 1, width: 1, background: 'var(--border-color)', margin: '4px 0' }} />
      )}
    </div>
  );
}

export default function ExpressPostPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isStory, setIsStory] = useState(false);
  const [mode, setMode] = useState<'now' | 'approval'>('now');
  const [caption, setCaption] = useState('');
  const [mediaList, setMediaList] = useState<PostMedia[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishPct, setPublishPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  const mediaCountRef = useRef(0);
  const captionRef = useRef('');

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    mediaCountRef.current = mediaList.length;
  }, [mediaList]);
  useEffect(() => {
    captionRef.current = caption;
  }, [caption]);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => stopProgressTimer, [stopProgressTimer]);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const { data: igAccount } = useQuery<IgAccount | null>({
    queryKey: ['ig-account-express', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return null;
      const { data } = await supabase
        .from('instagram_accounts')
        .select(
          'id, username, profile_picture_url, authorization_status, token_expires_at, permissions',
        )
        .eq('client_id', selectedClientId)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedClientId,
  });

  const { data: clientsWithIg = [] } = useQuery({
    queryKey: ['clients-with-ig'],
    queryFn: async () => {
      const { data } = await supabase.from('instagram_accounts').select('client_id');
      return (data ?? []).map((r: { client_id: number }) => r.client_id);
    },
  });

  // Fail closed until entitlements RESOLVE: a post sent to a workspace whose
  // hub portal is disabled becomes invisible to the client (resolveHubToken
  // rejects the entitlement), so "loading/error" must not read as "allowed".
  // isUnlimited is only true after a successful load of an unlimited plan.
  const { features, isUnlimited } = useWorkspaceLimits();
  const approvalAllowed = isUnlimited || features?.feature_hub_portal === true;

  useEffect(() => {
    if (!approvalAllowed && mode === 'approval') setMode('now');
  }, [approvalAllowed, mode]);

  const { data: hubToken, isLoading: hubTokenLoading } = useQuery({
    queryKey: ['hub-token-express', selectedClientId],
    queryFn: () => getHubToken(selectedClientId!),
    enabled: !!selectedClientId && mode === 'approval' && approvalAllowed,
  });
  const hubTokenUsable =
    !!hubToken && hubToken.is_active && new Date(hubToken.expires_at).getTime() > Date.now();

  const eligibleClients = clientes
    .filter((c) => clientsWithIg.includes(c.id!))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const igAccountStatus = igAccount
    ? {
        revoked: igAccount.authorization_status === 'revoked',
        expired:
          igAccount.authorization_status === 'expired' ||
          (igAccount.token_expires_at ? new Date(igAccount.token_expires_at) < new Date() : false),
        canPublish:
          Array.isArray(igAccount.permissions) &&
          igAccount.permissions.includes('instagram_business_content_publish'),
      }
    : null;

  const accountBlocked = igAccountStatus?.revoked || igAccountStatus?.expired;
  const missingPublishPermission = igAccountStatus ? !igAccountStatus.canPublish : false;
  const accountWarning = accountBlocked || missingPublishPermission;

  let warningMessage: string | null = null;
  if (igAccountStatus?.revoked) {
    warningMessage = t('warnings.revoked');
  } else if (igAccountStatus?.expired) {
    warningMessage = t('warnings.expired');
  } else if (missingPublishPermission) {
    warningMessage = t('warnings.missingPermission');
  }

  const detectedType = detectPostType(mediaList);
  // Stories override media-shape detection; the rest of the page keys off effectiveType.
  const effectiveType: 'feed' | 'reels' | 'carrossel' | 'stories' | null = isStory
    ? 'stories'
    : detectedType;
  const canPublish =
    !!draft &&
    (isStory || !!caption.trim()) &&
    mediaList.length > 0 &&
    !accountWarning &&
    !loading &&
    (mode === 'now' || hubTokenUsable);

  // Step completion is derived affordance only; steps never block interaction.
  const step2Done = !!draft;
  const step3Done = mediaList.length > 0;
  const step4Done = isStory || !!caption.trim();
  const currentStep = !step2Done ? 2 : !step3Done ? 3 : !step4Done ? 4 : 5;
  const stepState = (n: 2 | 3 | 4): 'done' | 'active' | 'todo' => {
    const done = n === 2 ? step2Done : n === 3 ? step3Done : step4Done;
    if (done) return 'done';
    return currentStep === n ? 'active' : 'todo';
  };

  async function createDraft(clientId: number, clientName: string) {
    setCreatingDraft(true);
    try {
      const now = new Date();
      const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

      const workflow = await addWorkflow({
        cliente_id: clientId,
        titulo: `Post Express - ${clientName} - ${dateStr}`,
        status: 'ativo',
        etapa_atual: 0,
        recorrente: false,
        modo_prazo: 'padrao',
      });

      await addWorkflowEtapa({
        workflow_id: workflow.id!,
        ordem: 0,
        nome: 'Publicação',
        prazo_dias: 0,
        tipo_prazo: 'corridos',
        tipo: 'padrao',
        status: 'concluido',
        iniciado_em: now.toISOString(),
        responsavel_id: null,
      });

      const post = await addWorkflowPost({
        workflow_id: workflow.id!,
        status: 'rascunho',
        tipo: 'feed',
        titulo: 'Post Express',
        conteudo: null,
        conteudo_plain: '',
        ordem: 0,
        is_express: true,
      });

      setDraft({ workflowId: workflow.id!, postId: post.id! });
    } catch (err: unknown) {
      toast.error(
        t('toast.draftError', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setCreatingDraft(false);
    }
  }

  async function deleteDraft(wfId: number) {
    try {
      await removeWorkflow(wfId);
    } catch {
      /* fire-and-forget */
    }
  }

  async function handleClientChange(clientId: number | null) {
    if (draft) {
      await deleteDraft(draft.workflowId);
      setDraft(null);
    }
    setCaption('');
    setMediaList([]);
    setSelectedClientId(clientId);

    if (clientId) {
      const client = clientes.find((c) => c.id === clientId);
      if (client) await createDraft(clientId, client.nome);
    }
  }

  useEffect(() => {
    return () => {
      const d = draftRef.current;
      if (d && mediaCountRef.current === 0 && !captionRef.current.trim()) {
        removeWorkflow(d.workflowId).catch(() => {});
      }
    };
  }, []);

  function resetPage() {
    setDraft(null);
    setSelectedClientId(null);
    setCaption('');
    setMediaList([]);
    setIsStory(false);
  }

  const handlePublishNow = async () => {
    if (!draft || !effectiveType) return;

    setPublishing(true);
    setPublishPct(0);
    setLoading(true);

    let pct = 0;
    timerRef.current = setInterval(() => {
      pct += (90 - pct) * 0.08;
      setPublishPct(Math.round(pct));
    }, 300);

    try {
      await updateWorkflowPost(draft.postId, {
        status: 'aprovado_cliente',
        ig_caption: isStory ? '' : caption.trim(),
        tipo: effectiveType,
      });

      const result = await publishInstagramPostNow(draft.postId);

      stopProgressTimer();
      setPublishPct(100);
      await new Promise((r) => setTimeout(r, 600));
      setConfirmOpen(false);

      await updateWorkflow(draft.workflowId, { status: 'concluido' });

      if (result.status === 'postado') {
        toast.success(t('toast.published'), {
          action: { label: t('toast.viewPost'), onClick: () => navigate('/entregas') },
        });
      } else {
        toast.info(t('toast.processing'), {
          action: { label: t('toast.viewDeliveries'), onClick: () => navigate('/entregas') },
        });
      }

      resetPage();
    } catch (err: unknown) {
      stopProgressTimer();
      setConfirmOpen(false);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setPublishing(false);
      setPublishPct(0);
    }
  };

  // Approval mode: the post goes to the client's Hub instead of publishing.
  // The workflow stays "ativo" so the approval notification's drawer link and
  // the manual-publish path keep working.
  const handleSendForApproval = async () => {
    if (!draft || !effectiveType || !selectedClientId) return;

    setLoading(true);
    try {
      // The gating query may be stale: a link deactivated or expired after the
      // page loaded would strand the post in enviado_cliente where the client
      // can't see it. Re-check at submit time and refuse to send.
      const freshToken = await getHubToken(selectedClientId);
      const freshUsable =
        !!freshToken &&
        freshToken.is_active &&
        new Date(freshToken.expires_at).getTime() > Date.now();
      if (!freshUsable) {
        setConfirmOpen(false);
        toast.error(t('approval.noHubLink'));
        queryClient.invalidateQueries({ queryKey: ['hub-token-express', selectedClientId] });
        return;
      }

      await updateWorkflowPost(draft.postId, {
        status: 'enviado_cliente',
        ig_caption: isStory ? '' : caption.trim(),
        tipo: effectiveType,
      });

      setConfirmOpen(false);
      toast.success(t('approval.toastSent'), {
        action: { label: t('toast.viewDeliveries'), onClick: () => navigate('/entregas') },
      });
      resetPage();
    } catch (err: unknown) {
      setConfirmOpen(false);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleMediaChange = useCallback((media: PostMedia[]) => {
    setMediaList(media);
  }, []);

  const stepLabel = (n: number, name: string) => (
    <label
      className="block text-xs font-semibold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}
    >
      {t('steps.step', { n })} · {name}
    </label>
  );

  return (
    <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 4vw, 3.2rem)',
              fontWeight: 900,
            }}
          >
            {t('title')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            {t('subtitle')}
          </p>
        </div>

        {eligibleClients.length === 0 && (
          <div className="mb-4">
            <PrerequisiteAlert
              title="Nenhum cliente com Instagram configurado"
              description="Para usar o Post Express, conecte uma conta Instagram em pelo menos um cliente."
              actionLabel="Ir para Clientes →"
              actionHref="/clientes"
            />
          </div>
        )}

        {/* Vertical stepper: all steps on one page, top to bottom */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', columnGap: '14px' }}
        >
          {/* Step 1: Formato */}
          <StepIndicator state="done" number={1} />
          <div style={STEP_CARD_STYLE}>
            {stepLabel(1, t('format.label'))}
            <div
              className="grid grid-cols-2 gap-1 p-1 rounded-lg"
              style={{ background: 'var(--surface-darker)', maxWidth: '360px' }}
            >
              {([false, true] as const).map((story) => {
                const active = isStory === story;
                return (
                  <button
                    key={String(story)}
                    type="button"
                    onClick={() => setIsStory(story)}
                    disabled={loading}
                    className="py-2 text-sm font-semibold rounded-md transition-colors"
                    style={
                      active
                        ? { background: 'var(--cta-bg)', color: 'var(--cta-fg)' }
                        : { background: 'transparent', color: 'var(--text-muted)' }
                    }
                  >
                    {story ? t('format.stories') : t('format.post')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Cliente */}
          <StepIndicator state={stepState(2)} number={2} />
          <div style={STEP_CARD_STYLE}>
            {stepLabel(2, t('labels.client'))}
            <select
              value={selectedClientId ?? ''}
              onChange={(e) =>
                handleClientChange(e.target.value ? parseInt(e.target.value, 10) : null)
              }
              disabled={loading || creatingDraft}
              className="w-full pl-3 pr-10 py-2 text-sm border"
              style={{
                fontFamily: 'var(--font-main)',
                maxWidth: '360px',
                background: 'var(--surface-main)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
                borderRadius: '4px',
                appearance: 'none',
                WebkitAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.75rem center',
              }}
            >
              <option value="">{t('select.client')}</option>
              {eligibleClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            {eligibleClients.length === 0 && (
              <div className="mt-2">
                <EmptyStateGuide
                  icon="📸"
                  title={t('empty.noClientsWithIg')}
                  description="Conecte uma conta Instagram em um cliente para começar a publicar."
                  actionLabel={t('empty.connectAccount')}
                  actionHref="/clientes"
                />
              </div>
            )}
            {igAccount && (
              <div className="flex items-center gap-2 mt-2">
                {igAccount.profile_picture_url && (
                  <img
                    src={igAccount.profile_picture_url}
                    alt=""
                    className="w-5 h-5 rounded-full"
                    style={{ border: '1.5px solid #E1306C' }}
                  />
                )}
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  @{igAccount.username ?? 'conta'}
                </span>
              </div>
            )}
            {warningMessage && selectedClientId && (
              <div
                className="flex items-center gap-2 rounded-lg px-4 py-3 text-xs mt-3"
                style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{warningMessage}</span>
                <a
                  href={`/clientes/${selectedClientId}`}
                  className="ml-auto underline font-medium whitespace-nowrap"
                  style={{ color: '#f55a42' }}
                >
                  Reconectar →
                </a>
              </div>
            )}
          </div>

          {/* Step 3: Mídia */}
          <StepIndicator state={stepState(3)} number={3} />
          <div style={STEP_CARD_STYLE}>
            {stepLabel(3, t('labels.media'))}
            {draft ? (
              <>
                <PostMediaGallery
                  postId={draft.postId}
                  maxFiles={
                    isStory || detectedType === 'carrossel' || mediaList.length > 1 ? undefined : 1
                  }
                  onChange={handleMediaChange}
                />
                {effectiveType && (
                  <div className="mt-3">
                    {(() => {
                      const typeInfo = getTypeLabel(effectiveType, t);
                      const Icon = typeInfo.icon;
                      const label =
                        isStory && mediaList.length > 1
                          ? `${typeInfo.label} · ${t('story.segments', { count: mediaList.length })}`
                          : typeInfo.label;
                      return (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ color: typeInfo.color, background: typeInfo.bg }}
                        >
                          <Icon className="h-3.5 w-3.5" /> {label}
                        </span>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {creatingDraft ? t('empty.preparingDraft') : t('steps.needClient')}
              </p>
            )}
          </div>

          {/* Step 4: Legenda */}
          <StepIndicator state={stepState(4)} number={4} />
          <div style={STEP_CARD_STYLE}>
            {stepLabel(4, t('labels.caption'))}
            {isStory ? (
              <div
                className="flex items-center gap-2 rounded-lg px-4 py-3 text-xs"
                style={{
                  color: 'var(--text-muted)',
                  background: 'var(--surface-hover)',
                  border: '1px dashed var(--border-color)',
                }}
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{t('story.captionHidden')}</span>
              </div>
            ) : (
              <>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
                  placeholder={t('captionPlaceholder')}
                  disabled={!draft || loading}
                  rows={6}
                  className="w-full rounded px-3 py-2.5 text-sm resize-none border"
                  style={{
                    fontFamily: 'var(--font-main)',
                    background: 'var(--surface-main)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                />
                <div className="flex justify-end mt-1">
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {caption.length} / {MAX_CAPTION}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Step 5: Envio */}
          <StepIndicator state={currentStep === 5 ? 'active' : 'todo'} number={5} isLast />
          <div style={{ ...STEP_CARD_STYLE, marginBottom: 0 }}>
            {stepLabel(5, t('steps.send'))}

            {approvalAllowed && (
              <div
                className="grid grid-cols-2 gap-1 p-1 rounded-lg"
                style={{ background: 'var(--surface-darker)', maxWidth: '360px' }}
              >
                {(['now', 'approval'] as const).map((m) => {
                  const active = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      disabled={loading}
                      className="py-2 text-sm font-semibold rounded-md transition-colors"
                      style={
                        active
                          ? { background: 'var(--cta-bg)', color: 'var(--cta-fg)' }
                          : { background: 'transparent', color: 'var(--text-muted)' }
                      }
                    >
                      {m === 'now' ? t('mode.publishNow') : t('mode.approval')}
                    </button>
                  );
                })}
              </div>
            )}

            {mode === 'approval' && selectedClientId && !hubTokenLoading && (
              <div className="mt-3">
                {hubTokenUsable ? (
                  <div
                    className="flex items-center gap-2 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Link2 className="h-4 w-4 flex-shrink-0" style={{ color: '#3ecf8e' }} />
                    <span>{t('approval.hubLinkActive')}</span>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 rounded-lg px-4 py-3 text-xs"
                    style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
                  >
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{t('approval.noHubLink')}</span>
                    <a
                      href={`/clientes/${selectedClientId}`}
                      className="ml-auto underline font-medium whitespace-nowrap"
                      style={{ color: '#f55a42' }}
                    >
                      {t('approval.noHubLinkAction')} →
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Compact Instagram preview */}
            {draft && igAccount && (
              <div className="mt-4">
                <label
                  className="block text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}
                >
                  {t('labels.preview')}
                </label>
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ background: '#000', padding: '0.75rem', maxWidth: '240px' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {igAccount.profile_picture_url ? (
                      <img
                        src={igAccount.profile_picture_url}
                        alt=""
                        className="w-6 h-6 rounded-full"
                        style={{ border: '1.5px solid #E1306C' }}
                      />
                    ) : (
                      <div
                        className="w-6 h-6 rounded-full"
                        style={{ background: 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' }}
                      />
                    )}
                    <span className="text-xs font-semibold" style={{ color: '#e8eaf0' }}>
                      @{igAccount.username ?? 'conta'}
                    </span>
                  </div>
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{
                      background: '#1a1e26',
                      aspectRatio: isStory ? '9 / 16' : '1',
                      maxWidth: isStory ? '150px' : undefined,
                      margin: isStory ? '0 auto' : undefined,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isStory && mediaList.length > 1 && (
                      <>
                        <div
                          style={{
                            position: 'absolute',
                            top: 6,
                            left: 6,
                            right: 6,
                            display: 'flex',
                            gap: 3,
                            zIndex: 2,
                          }}
                        >
                          {mediaList.map((m, i) => (
                            <span
                              key={m.id}
                              style={{
                                flex: 1,
                                height: 2.5,
                                borderRadius: 2,
                                background: i === 0 ? '#fff' : 'rgba(255,255,255,0.35)',
                              }}
                            />
                          ))}
                        </div>
                        <span
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 8,
                            zIndex: 2,
                            color: '#fff',
                            fontSize: '0.6rem',
                            background: 'rgba(0,0,0,0.5)',
                            padding: '1px 6px',
                            borderRadius: 8,
                          }}
                        >
                          1/{mediaList.length}
                        </span>
                      </>
                    )}
                    {mediaList.length > 0 && mediaList[0].url ? (
                      mediaList[0].kind === 'video' ? (
                        <video
                          src={mediaList[0].url}
                          poster={mediaList[0].thumbnail_url ?? undefined}
                          muted
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={mediaList[0].thumbnail_url ?? mediaList[0].url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )
                    ) : (
                      <span className="text-xs" style={{ color: '#4b5563' }}>
                        {t('empty.mediaPlaceholder')}
                      </span>
                    )}
                  </div>
                  {!isStory && caption && (
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
                      <strong style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</strong>{' '}
                      {caption.length > 100 ? caption.slice(0, 100) + '...' : caption}
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button
              data-testid="express-submit"
              onClick={() => setConfirmOpen(true)}
              disabled={!canPublish}
              className="w-full text-sm font-bold py-3 mt-4"
              style={{ borderRadius: '8px' }}
            >
              <Send className="h-4 w-4 mr-2" />{' '}
              {mode === 'approval'
                ? t('approval.button')
                : t(isStory ? 'publish.buttonStories' : 'publish.button')}
            </Button>
            {draft && (
              <p className="text-center text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {t(mode === 'approval' ? 'approval.note' : 'publish.note')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!publishing) setConfirmOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishing
                ? t('publish.publishingTitle')
                : mode === 'approval'
                  ? t('approval.confirmTitle')
                  : t('publish.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishing
                ? t('publish.publishingDescription')
                : mode === 'approval'
                  ? t('approval.confirmDescription')
                  : t('publish.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishing && (
            <div className="px-1">
              <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                <span>{publishPct < 100 ? t('progress.sending') : t('progress.done')}</span>
                <span className="tabular-nums font-medium text-stone-900">{publishPct}%</span>
              </div>
              <div className="h-2 rounded-lg bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-lg transition-all duration-300 ease-out"
                  style={{
                    width: `${publishPct}%`,
                    background: publishPct < 100 ? '#E1306C' : '#3ecf8e',
                  }}
                />
              </div>
            </div>
          )}
          {!publishing && (
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>{tc('actions.cancel')}</AlertDialogCancel>
              {mode === 'approval' ? (
                <Button onClick={handleSendForApproval} disabled={loading}>
                  {t('approval.sendAction')}
                </Button>
              ) : (
                <Button
                  onClick={handlePublishNow}
                  style={{ background: '#E1306C', color: 'white' }}
                >
                  {t('publish_action')}
                </Button>
              )}
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
