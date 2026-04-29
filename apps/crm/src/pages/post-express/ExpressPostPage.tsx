import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, AlertCircle, Image, Film, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase';
import {
  getClientes, addWorkflow, addWorkflowEtapa, addWorkflowPost,
  updateWorkflowPost, updateWorkflow, removeWorkflow,
  type PostMedia,
} from '../../store';
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

function getTypeLabel(type: 'feed' | 'reels' | 'carrossel'): { label: string; color: string; bg: string; icon: typeof Image } {
  switch (type) {
    case 'feed': return { label: 'Feed', color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: Image };
    case 'reels': return { label: 'Reels', color: '#E1306C', bg: 'rgba(225,48,108,0.12)', icon: Film };
    case 'carrossel': return { label: 'Carrossel', color: '#42c8f5', bg: 'rgba(66,200,245,0.12)', icon: Images };
  }
}

const MAX_CAPTION = 2200;

export default function ExpressPostPage() {
  const navigate = useNavigate();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
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

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { mediaCountRef.current = mediaList.length; }, [mediaList]);
  useEffect(() => { captionRef.current = caption; }, [caption]);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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
        .select('id, username, profile_picture_url, authorization_status, token_expires_at, permissions')
        .eq('client_id', selectedClientId)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedClientId,
  });

  const { data: clientsWithIg = [] } = useQuery({
    queryKey: ['clients-with-ig'],
    queryFn: async () => {
      const { data } = await supabase
        .from('instagram_accounts')
        .select('client_id');
      return (data ?? []).map((r: { client_id: number }) => r.client_id);
    },
  });

  const eligibleClients = clientes.filter((c) => clientsWithIg.includes(c.id!));

  const igAccountStatus = igAccount ? {
    revoked: igAccount.authorization_status === 'revoked',
    expired: igAccount.token_expires_at ? new Date(igAccount.token_expires_at) < new Date() : false,
    canPublish: Array.isArray(igAccount.permissions) && igAccount.permissions.includes('instagram_business_content_publish'),
  } : null;

  const accountBlocked = igAccountStatus?.revoked || igAccountStatus?.expired;
  const missingPublishPermission = igAccountStatus ? !igAccountStatus.canPublish : false;
  const accountWarning = accountBlocked || missingPublishPermission;

  let warningMessage: string | null = null;
  if (igAccountStatus?.revoked) {
    warningMessage = 'Token do Instagram foi revogado. Reconecte a conta nas configurações do cliente.';
  } else if (igAccountStatus?.expired) {
    warningMessage = 'Token do Instagram expirou. Reconecte a conta nas configurações do cliente.';
  } else if (missingPublishPermission) {
    warningMessage = 'Permissão de publicação não concedida. Reconecte a conta com as permissões necessárias.';
  }

  const detectedType = detectPostType(mediaList);
  const canPublish = !!draft && !!caption.trim() && mediaList.length > 0 && !accountWarning && !loading;

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
      });

      setDraft({ workflowId: workflow.id!, postId: post.id! });
    } catch (err: unknown) {
      toast.error('Erro ao preparar rascunho: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreatingDraft(false);
    }
  }

  async function deleteDraft(wfId: number) {
    try { await removeWorkflow(wfId); } catch { /* fire-and-forget */ }
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

  const handlePublishNow = async () => {
    if (!draft || !detectedType) return;

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
        ig_caption: caption.trim(),
        tipo: detectedType,
      });

      const result = await publishInstagramPostNow(draft.postId);

      stopProgressTimer();
      setPublishPct(100);
      await new Promise((r) => setTimeout(r, 600));
      setConfirmOpen(false);

      await updateWorkflow(draft.workflowId, { status: 'concluido' });

      if (result.status === 'postado') {
        toast.success('Post publicado no Instagram!', {
          action: { label: 'Ver post', onClick: () => navigate('/entregas') },
        });
      } else {
        toast.info('Post sendo processado pelo Instagram. Acompanhe na página de entregas.', {
          action: { label: 'Ver entregas', onClick: () => navigate('/entregas') },
        });
      }

      setDraft(null);
      setSelectedClientId(null);
      setCaption('');
      setMediaList([]);
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

  const handleMediaChange = useCallback((media: PostMedia[]) => {
    setMediaList(media);
  }, []);

  return (
    <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 4vw, 3.2rem)', fontWeight: 900 }}>
          Post Express
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Publique rapidamente no Instagram
        </p>
      </div>

      {/* Warning banner */}
      {warningMessage && selectedClientId && (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3 text-xs mb-4"
          style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {warningMessage}
        </div>
      )}

      {/* Two-column grid */}
      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))' }}>

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* Client Picker */}
          <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              Cliente
            </label>
            <select
              value={selectedClientId ?? ''}
              onChange={(e) => handleClientChange(e.target.value ? parseInt(e.target.value, 10) : null)}
              disabled={loading || creatingDraft}
              className="w-full rounded-lg px-3 py-2 text-sm border"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-main)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            >
              <option value="">Selecionar cliente...</option>
              {eligibleClients.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            {eligibleClients.length === 0 && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Nenhum cliente com Instagram conectado.{' '}
                <a href="/clientes" style={{ color: '#eab308' }}>Conectar conta</a>
              </p>
            )}
            {igAccount && (
              <div className="flex items-center gap-2 mt-2">
                {igAccount.profile_picture_url && (
                  <img src={igAccount.profile_picture_url} alt="" className="w-5 h-5 rounded-full" style={{ border: '1.5px solid #E1306C' }} />
                )}
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  @{igAccount.username ?? 'conta'}
                </span>
              </div>
            )}
          </div>

          {/* Media Upload */}
          {draft && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Mídia
              </label>
              <PostMediaGallery
                postId={draft.postId}
                maxFiles={detectedType === 'carrossel' || mediaList.length > 1 ? undefined : 1}
                onChange={handleMediaChange}
              />

              {/* Detected type badge */}
              {detectedType && (
                <div className="mt-3">
                  {(() => {
                    const t = getTypeLabel(detectedType);
                    const Icon = t.icon;
                    return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                        style={{ color: t.color, background: t.bg }}>
                        <Icon className="h-3.5 w-3.5" /> {t.label}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {creatingDraft && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '2rem', border: '1px solid var(--border-color)', textAlign: 'center' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Preparando rascunho...</p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* Caption */}
          <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              Legenda do Instagram
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
              placeholder="Escreva a legenda do post aqui..."
              disabled={!draft || loading}
              rows={8}
              className="w-full rounded-lg px-3 py-2.5 text-sm resize-none border"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-main)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            />
            <div className="flex justify-end mt-1">
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {caption.length} / {MAX_CAPTION}
              </span>
            </div>
          </div>

          {/* Instagram Preview */}
          {draft && igAccount && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Preview
              </label>
              <div className="rounded-xl overflow-hidden" style={{ background: '#000', padding: '0.75rem', maxWidth: '300px', margin: '0 auto' }}>
                <div className="flex items-center gap-2 mb-2">
                  {igAccount.profile_picture_url ? (
                    <img src={igAccount.profile_picture_url} alt="" className="w-6 h-6 rounded-full" style={{ border: '1.5px solid #E1306C' }} />
                  ) : (
                    <div className="w-6 h-6 rounded-full" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' }} />
                  )}
                  <span className="text-xs font-semibold" style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</span>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ background: '#1a1e26', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {mediaList.length > 0 && mediaList[0].url ? (
                    mediaList[0].kind === 'video' ? (
                      <video src={mediaList[0].url} poster={mediaList[0].thumbnail_url ?? undefined} muted className="w-full h-full object-cover" />
                    ) : (
                      <img src={mediaList[0].thumbnail_url ?? mediaList[0].url} alt="" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <span className="text-xs" style={{ color: '#4b5563' }}>Mídia aparece aqui</span>
                  )}
                </div>
                {caption && (
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
                    <strong style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</strong>{' '}
                    {caption.length > 100 ? caption.slice(0, 100) + '...' : caption}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Publish Button */}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canPublish}
            className="w-full text-sm font-bold py-3"
            style={canPublish ? { background: '#E1306C', color: 'white' } : undefined}
          >
            <Send className="h-4 w-4 mr-2" /> Publicar agora
          </Button>
          {draft && (
            <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              O post será publicado imediatamente no Instagram
            </p>
          )}
        </div>
      </div>

      {/* Publish Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!publishing) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{publishing ? 'Publicando…' : 'Publicar agora?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {publishing
                ? 'Aguarde enquanto o post é publicado no Instagram.'
                : 'O post será publicado imediatamente no Instagram. Esta ação não pode ser desfeita.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishing && (
            <div className="px-1">
              <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                <span>{publishPct < 100 ? 'Enviando para o Instagram…' : 'Concluído!'}</span>
                <span className="tabular-nums font-medium text-stone-900">{publishPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${publishPct}%`, background: publishPct < 100 ? '#E1306C' : '#3ecf8e' }}
                />
              </div>
            </div>
          )}
          {!publishing && (
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <Button onClick={handlePublishNow} style={{ background: '#E1306C', color: 'white' }}>
                Publicar
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
