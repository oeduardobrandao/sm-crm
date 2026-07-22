import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
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

const COLOR_SWATCH: CSSProperties = {
  width: 48,
  height: 36,
  padding: 2,
  borderRadius: 6,
  border: '1px solid var(--border-color)',
  cursor: 'pointer',
  background: 'none',
};

const COLOR_VALUE: CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label style={{ display: 'block', marginBottom: 6 }}>{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={COLOR_SWATCH}
      />
      <div style={COLOR_VALUE}>{value}</div>
    </div>
  );
}

/** Branding for the monthly client report, with a live preview. */
export default function RelatoriosTab() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  // The workspace supplies the logo and name shown in the live preview, plus
  // the id used to persist the cover art. Name/logo are edited on the Workspace
  // tab; here they are read-only. Shared query key with WorkspaceTab.
  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
    enabled: isOwnerOrAdmin,
  });

  type WorkspaceBranding = Awaited<ReturnType<typeof getWorkspaceBranding>>;
  const { data: branding } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
    enabled: isOwnerOrAdmin,
  });

  const [brandColor, setBrandColor] = useState('#eab308');
  const [sendReportEmail, setSendReportEmail] = useState(false);
  const [splashUrl, setSplashUrl] = useState<string | null>(null);
  const [splashUploading, setSplashUploading] = useState(false);
  const [splashRemoveOpen, setSplashRemoveOpen] = useState(false);
  const splashInputRef = useRef<HTMLInputElement>(null);
  const brandingInitializedRef = useRef(false);

  useEffect(() => {
    if (branding) {
      // Seed brandColor/sendReportEmail only once: a refetch triggered by the
      // splash handlers (e.g. after upload) must not clobber an in-flight,
      // unsaved edit to these fields. splashUrl has no "Salvar" step of its
      // own, so it always tracks the server value.
      if (!brandingInitializedRef.current) {
        setBrandColor(branding.brand_color ?? '#eab308');
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Use uma imagem JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Imagem muito grande (máx. 4MB).');
      return;
    }
    setSplashUploading(true);
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
      toast.error('Erro ao enviar a arte: ' + (err as Error).message);
    } finally {
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
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setSplashUploading(false);
      setSplashRemoveOpen(false);
    }
  };

  const brandingMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceBranding({
        brand_color: brandColor,
        send_report_email: sendReportEmail,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-branding'] });
      toast.success('Configurações de relatório salvas!');
    },
    onError: (err: unknown) => {
      toast.error('Erro ao salvar: ' + (err as Error).message);
    },
  });

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="config-title">Relatório Mensal</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
        Personalize a cor de destaque e a arte de capa dos relatórios mensais enviados para seus
        clientes.
      </p>

      <div className="config-report-grid">
        <div>
          {/* Accent colour */}
          <ColorField label="Cor de destaque" value={brandColor} onChange={setBrandColor} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            A mesma cor de destaque do Hub do Cliente. Usada em marcações do relatório — nunca nos
            gráficos de dados.
          </div>

          {/* Cover splash art */}
          <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
            <Label style={{ display: 'block', marginBottom: 6 }}>Arte da capa</Label>
            {splashUrl ? (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <img
                  src={splashUrl}
                  alt="Arte da capa"
                  style={{
                    width: 168,
                    height: 72,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => splashInputRef.current?.click()}
                  disabled={splashUploading}
                >
                  {splashUploading ? 'Enviando…' : 'Substituir'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSplashRemoveOpen(true)}
                  disabled={splashUploading}
                >
                  Remover
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  variant="outline"
                  onClick={() => splashInputRef.current?.click()}
                  disabled={splashUploading}
                >
                  {splashUploading ? 'Enviando…' : 'Enviar imagem'}
                </Button>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Aparece na capa do relatório (formato paisagem, ~21:9). Sem arte, a capa fica só
                  tipográfica.
                </div>
              </div>
            )}
            <input
              ref={splashInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleSplashUpload(file);
              }}
            />
          </div>

          {/* Email delivery toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <Switch checked={sendReportEmail} onCheckedChange={setSendReportEmail} />
            <div>
              <div style={{ fontWeight: 500 }}>Enviar relatórios por e-mail</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Quando ativado, relatórios mensais serão enviados automaticamente para clientes
                habilitados.
              </div>
            </div>
          </div>

          <Button onClick={() => brandingMutation.mutate()} disabled={brandingMutation.isPending}>
            {brandingMutation.isPending && <Spinner size="sm" />} Salvar
          </Button>
        </div>

        {/* Live preview */}
        <ReportPreview
          accentColor={brandColor}
          splashUrl={splashUrl}
          logoUrl={workspace?.logo_url ?? null}
          workspaceName={workspace?.name ?? ''}
        />
      </div>

      {/* Remove Report Splash Confirm */}
      <AlertDialog open={splashRemoveOpen} onOpenChange={setSplashRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a arte da capa?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveSplash}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
