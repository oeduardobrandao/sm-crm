import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { holdUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import {
  getCurrentWorkspace,
  getWorkspaceBranding,
  updateWorkspace,
  updateWorkspaceBranding,
} from '../../../store';
import { ReportPreview } from '../ReportPreview';
import { downscaleImage } from '../reportSplash';

const MAX_SPLASH_BYTES = 4 * 1024 * 1024;
const SPLASH_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const FIELD: CSSProperties = { marginBottom: '1.5rem' };
const FIELD_LABEL: CSSProperties = { display: 'block', marginBottom: '0.5rem' };
const HINT: CSSProperties = {
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-muted)',
  marginTop: '0.5rem',
  maxWidth: '52ch',
};

/** Branding for the monthly client report, with a live preview. */
export default function RelatoriosTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  // The `configuracoes` tab itself is already gated on `configuracoes:ver`
  // at the tab layer (configTabs.ts, Task 12) -- mirrors that for this tab's
  // own queries. Was `role === 'owner' || role === 'admin'`, which a custom
  // role with the chassis 'agent' role never passed even when it held the
  // tab-level grant.
  const canViewConfig = can('configuracoes', 'ver') === true;
  // F4 (revisão externa): `ver`-only ainda via todos os controles de escrita.
  // `updateWorkspaceBranding` grava em `workspaces`, cuja RLS FILTRA a linha
  // em vez de levantar erro -- o PostgREST devolvia 200 com zero linhas e o
  // toast de sucesso mentia. O backstop de zero linhas fica em
  // store/workspace.ts; esconder o controle é a correção primária.
  const canEditConfig = can('configuracoes', 'editar') === true;

  // The workspace supplies the logo and name shown in the live preview, plus
  // the id used to persist the cover art. Name/logo are edited on the Workspace
  // tab; here they are read-only. Shared query key with WorkspaceTab.
  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
    enabled: canViewConfig,
  });

  type WorkspaceBranding = Awaited<ReturnType<typeof getWorkspaceBranding>>;
  const {
    data: branding,
    isPending: brandingPending,
    isError: brandingFailed,
  } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
    enabled: canViewConfig,
  });

  const [sendReportEmail, setSendReportEmail] = useState(false);
  const [splashUrl, setSplashUrl] = useState<string | null>(null);
  const [splashUploading, setSplashUploading] = useState(false);
  const [splashRemoveOpen, setSplashRemoveOpen] = useState(false);
  const splashInputRef = useRef<HTMLInputElement>(null);
  const brandingInitializedRef = useRef(false);

  useEffect(() => {
    if (branding) {
      // Seed sendReportEmail only once: a refetch triggered by the splash handlers
      // (e.g. after upload) must not clobber an in-flight, unsaved edit to this
      // field. splashUrl has no "Salvar" step of its own, so it always tracks the
      // server value — same for brand_color, which this tab no longer edits (see
      // the read-only swatch below): it always shows whatever HubTab last saved.
      if (!brandingInitializedRef.current) {
        setSendReportEmail(branding.send_report_email ?? false);
        brandingInitializedRef.current = true;
      }
      setSplashUrl(branding.report_splash_url ?? null);
    }
  }, [branding]);

  // The splash art is persisted by its own upload/remove handlers (mirroring the
  // workspace logo), not by this card's "Salvar" button.
  const handleSplashUpload = async (file: File) => {
    if (!workspace) return;
    if (!SPLASH_TYPES.includes(file.type)) {
      toast.error('Formato não aceito. Envie um JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_SPLASH_BYTES) {
      toast.error('Imagem muito grande. O limite é 4MB.');
      return;
    }
    setSplashUploading(true);
    // The upload and the record update that follows are one unit of work: a silent
    // version swap must not land between them.
    const release = holdUnsavedWork();
    try {
      const blob = await downscaleImage(file);
      const path = `workspaces/${workspace.id}/report-splash.jpg`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();
      await updateWorkspace(workspace.id, { report_splash_url: publicUrl });
      setSplashUrl(publicUrl);
      queryClient.setQueryData(['workspace-branding'], (old: WorkspaceBranding | undefined) =>
        old ? { ...old, report_splash_url: publicUrl } : old,
      );
      toast.success('Arte da capa atualizada.');
    } catch (err: unknown) {
      console.error('report splash upload failed', err);
      toast.error('Não foi possível enviar a arte. Tente novamente.');
    } finally {
      release();
      setSplashUploading(false);
    }
  };

  const handleRemoveSplash = async () => {
    if (!workspace) return;
    setSplashUploading(true);
    try {
      await updateWorkspace(workspace.id, { report_splash_url: null });
      setSplashUrl(null);
      queryClient.setQueryData(['workspace-branding'], (old: WorkspaceBranding | undefined) =>
        old ? { ...old, report_splash_url: null } : old,
      );
      toast.success('Arte da capa removida.');
    } catch (err: unknown) {
      console.error('report splash removal failed', err);
      toast.error('Não foi possível remover a arte. Tente novamente.');
    } finally {
      setSplashUploading(false);
      setSplashRemoveOpen(false);
    }
  };

  const brandingMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceBranding({
        send_report_email: sendReportEmail,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-branding'] });
      // A matriz de Configuração > Notificações > Seus clientes lê o mesmo
      // campo por outra chave: invalida para não ficar defasada entre telas.
      queryClient.invalidateQueries({ queryKey: ['seus-clientes-branding'] });
      toast.success('Configurações de relatório salvas!');
    },
    onError: (err: unknown) => {
      console.error('report branding save failed', err);
      toast.error('Não foi possível salvar. Tente novamente.');
    },
  });

  // Read-only here: brand_color has ONE writer now, updateHubBranding on the Hub
  // tab (see store/workspace.ts) — a report-tab edit could otherwise race a
  // hub-tab edit for the same 'workspaces' column. This still reads it live from
  // the shared workspace-branding query, which HubTab's save invalidates too.
  const brandColor = branding?.brand_color ?? '#eab308';

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="config-title">Relatório Mensal</h3>
      <p style={{ ...HINT, marginTop: 0, marginBottom: canEditConfig ? '1.5rem' : '0.5rem' }}>
        A marca que seus clientes veem no relatório mensal do Instagram.
      </p>
      {!canEditConfig && (
        <p style={{ ...HINT, marginTop: 0, marginBottom: '1.5rem' }}>Somente leitura</p>
      )}

      <div className="config-report-grid">
        <div>
          {/* Accent colour: read-only, edited from Configurações → Hub now (it's
              shared with the client Hub calendar, so it has one editor). */}
          <div style={FIELD}>
            <Label style={FIELD_LABEL}>Cor de destaque</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: brandColor,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {brandColor}
              </span>
            </div>
            <p style={HINT}>
              A mesma cor do Hub do Cliente. Marca títulos e destaques; os gráficos mantêm as cores
              próprias, para os dados seguirem legíveis.{' '}
              <Link to="/configuracao/hub">Editar em Configurações · Hub</Link>
            </p>
          </div>

          {/* Cover splash art */}
          <div style={FIELD}>
            <Label htmlFor="report-splash-trigger" style={FIELD_LABEL}>
              Arte da capa
            </Label>
            {/* Wraps so the destructive action stays reachable on narrow screens,
                where thumbnail + both buttons overflow a single row. */}
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              {splashUrl && (
                <img
                  src={splashUrl}
                  alt="Arte da capa"
                  style={{
                    width: 72,
                    height: 72,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    opacity: splashUploading ? 0.5 : 1,
                    transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              )}
              <Button
                id="report-splash-trigger"
                variant="outline"
                onClick={() => splashInputRef.current?.click()}
                disabled={splashUploading || !canEditConfig}
              >
                {splashUploading && <Spinner size="sm" />}
                {splashUploading ? 'Enviando…' : splashUrl ? 'Substituir arte' : 'Enviar arte'}
              </Button>
              {splashUrl && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setSplashRemoveOpen(true)}
                  disabled={splashUploading || !canEditConfig}
                >
                  Remover arte
                </Button>
              )}
            </div>
            <p style={HINT}>
              Formato quadrado (1:1), JPEG, PNG ou WebP, até 4MB. Salva assim que você envia. Sem
              arte, a capa fica apenas tipográfica.
            </p>
            <input
              ref={splashInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={!canEditConfig}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file && canEditConfig) handleSplashUpload(file);
              }}
            />
          </div>

          {/* Email delivery toggle */}
          <div style={{ ...FIELD, display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <Switch
              id="report-email"
              checked={sendReportEmail}
              disabled={brandingPending || brandingFailed || !canEditConfig}
              onCheckedChange={setSendReportEmail}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <Label htmlFor="report-email" style={{ fontWeight: 500, cursor: 'pointer' }}>
                Enviar relatórios por e-mail
              </Label>
              <p style={{ ...HINT, marginTop: '0.25rem' }}>
                Envia o relatório automaticamente, todo mês, para os clientes com envio habilitado.
              </p>
            </div>
          </div>

          {brandingFailed && (
            <p
              role="alert"
              style={{
                ...HINT,
                color: 'var(--danger-text)',
                marginTop: 0,
                marginBottom: '0.75rem',
              }}
            >
              Não foi possível carregar as configurações de relatório. Recarregue a página. Salvar
              agora sobrescreveria a sua marca com os valores padrão.
            </p>
          )}

          {/* Saving before the branding query resolves would persist this form's
              placeholder values over the workspace's real branding. */}
          <Button
            onClick={() => brandingMutation.mutate()}
            disabled={
              brandingMutation.isPending || brandingPending || brandingFailed || !canEditConfig
            }
          >
            {brandingMutation.isPending && <Spinner size="sm" />} Salvar
          </Button>
        </div>

        {/* Live preview */}
        <div>
          <Label style={FIELD_LABEL}>Prévia</Label>
          <ReportPreview
            accentColor={brandColor}
            splashUrl={splashUrl}
            logoUrl={workspace?.logo_url ?? null}
            workspaceName={workspace?.name ?? ''}
          />
          <p style={{ ...HINT, maxWidth: 240 }}>O logo e o nome vêm da aba Workspace.</p>
        </div>
      </div>

      {/* Remove Report Splash Confirm */}
      <AlertDialog open={splashRemoveOpen} onOpenChange={setSplashRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a arte da capa?</AlertDialogTitle>
            <AlertDialogDescription>
              A capa dos próximos relatórios volta a ser apenas tipográfica. Você pode enviar outra
              arte quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveSplash}
              disabled={splashUploading || !canEditConfig}
            >
              Remover arte
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
