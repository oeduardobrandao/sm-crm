import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { holdUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { getCurrentWorkspace, updateWorkspace } from '../../../store';

/** Workspace identity (name + logo) and the Instagram auto-sync switch. */
export default function WorkspaceTab() {
  const { profile, can } = useAuth();
  const queryClient = useQueryClient();
  // The `configuracoes` tab itself is already gated on `configuracoes:ver`
  // at the route/tab layer (configTabs.ts, Task 12) -- this mirrors that
  // same check for the tab's OWN queries, which a custom role granted only
  // `ver` (not `editar`) can still reach. Was `role === 'owner' || role ===
  // 'admin'`, which a custom role with the chassis 'agent' role never passed
  // even when it held the tab-level grant.
  const canViewConfig = can('configuracoes', 'ver') === true;
  // F4 (revisão externa): `ver`-only still rendered every mutation control
  // here. `updateWorkspace` writes to `workspaces`, whose RLS policy FILTERS
  // the row out instead of raising -- PostgREST answers 200 with zero rows
  // affected, `updateWorkspace` never inspected the count, and the user got a
  // success toast for a save that never happened. Hiding the controls is the
  // primary fix; `store/workspace.ts` grew a zero-row throw as the backstop.
  const canEditConfig = can('configuracoes', 'editar') === true;

  const { data: workspace, refetch: refetchWorkspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
    enabled: canViewConfig,
  });

  const [wsName, setWsName] = useState('');
  const [wsLogoUrl, setWsLogoUrl] = useState<string | null>(null);
  const [wsLogoLoading, setWsLogoLoading] = useState(false);
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workspace) {
      setWsName(workspace.name ?? '');
      setWsLogoUrl(workspace.logo_url ?? null);
    }
  }, [workspace]);

  const handleLogoUpload = async (file: File) => {
    if (!workspace) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Arquivo deve ser menor que 2MB.');
      return;
    }
    setWsLogoLoading(true);
    // The upload and the record update that follows are one unit of work: a silent
    // version swap must not land between them.
    const release = holdUnsavedWork();
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const size = Math.min(bitmap.width, bitmap.height, 512);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, size, size);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));

      const path = `workspaces/${workspace.id}/logo.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();
      await updateWorkspace(workspace.id, { logo_url: publicUrl });
      setWsLogoUrl(publicUrl);
      refetchWorkspace();
      toast.success('Logo atualizada!');
    } catch (err: unknown) {
      toast.error('Erro ao enviar logo: ' + (err as Error).message);
    } finally {
      release();
      setWsLogoLoading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!workspace) return;
    setWsLogoLoading(true);
    try {
      await updateWorkspace(workspace.id, { logo_url: null });
      setWsLogoUrl(null);
      refetchWorkspace();
      toast.success('Logo removida.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setWsLogoLoading(false);
      setRemoveLogoOpen(false);
    }
  };

  const handleWsSave = async () => {
    if (!workspace || !wsName.trim()) return;
    try {
      await updateWorkspace(workspace.id, { name: wsName });
      refetchWorkspace();
      toast.success('Workspace atualizado!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  // --- Instagram auto-sync ---
  const { data: igAccounts } = useQuery({
    queryKey: ['igAccountsForSync'],
    queryFn: async () => {
      if (!profile?.conta_id) return [];
      const { data } = await supabase
        .from('instagram_accounts')
        .select('id, auto_sync_enabled, client_id, clientes!inner(conta_id)')
        .eq('clientes.conta_id', profile.conta_id);
      return data ?? [];
    },
    enabled: canViewConfig && !!profile?.conta_id,
  });

  const autoSyncEnabled = (igAccounts ?? []).some(
    (a: Record<string, unknown>) => a.auto_sync_enabled,
  );

  const handleAutoSyncToggle = async (checked: boolean) => {
    if (!igAccounts || igAccounts.length === 0) return;
    try {
      const ids = igAccounts.map((a: Record<string, unknown>) => a.id);
      const { error } = await supabase
        .from('instagram_accounts')
        .update({ auto_sync_enabled: checked })
        .in('id', ids);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['igAccountsForSync'] });
      toast.success(checked ? 'Auto-sync ativado.' : 'Auto-sync desativado.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  return (
    <>
      {workspace && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="config-title">Workspace</h3>
          {!canEditConfig && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              Somente leitura
            </p>
          )}
          <div style={{ marginBottom: '1rem' }}>
            <Label style={{ display: 'block', marginBottom: 8 }}>Logo</Label>
            {wsLogoUrl && (
              <div style={{ marginBottom: 12 }}>
                <img
                  src={wsLogoUrl}
                  alt="Logo"
                  style={{
                    maxHeight: 80,
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                  }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="outline"
                disabled={wsLogoLoading || !canEditConfig}
                onClick={() => logoInputRef.current?.click()}
              >
                {wsLogoLoading && <Spinner size="sm" />} {wsLogoUrl ? 'Trocar Logo' : 'Enviar Logo'}
              </Button>
              {wsLogoUrl && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={wsLogoLoading || !canEditConfig}
                  onClick={() => setRemoveLogoOpen(true)}
                >
                  Remover
                </Button>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              disabled={!canEditConfig}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && canEditConfig) handleLogoUpload(f);
                e.target.value = '';
              }}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
              PNG, JPG ou WebP. Máx 2MB. Será redimensionado para 512px.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <Label style={{ display: 'block', marginBottom: 6 }}>Nome do Workspace</Label>
              <Input
                value={wsName}
                disabled={!canEditConfig}
                onChange={(e) => setWsName(e.target.value)}
              />
            </div>
            <Button className="mb-0" disabled={!canEditConfig} onClick={handleWsSave}>
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* Instagram Auto-Sync */}
      {(igAccounts ?? []).length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="config-title">Auto-Sync Instagram</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Switch
              aria-label="Auto-sync do Instagram"
              checked={autoSyncEnabled}
              disabled={!canEditConfig}
              onCheckedChange={handleAutoSyncToggle}
            />
            <span>
              {autoSyncEnabled
                ? 'Sincronização automática ativada'
                : 'Sincronização automática desativada'}
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            Quando ativada, os dados do Instagram são sincronizados automaticamente uma vez por dia.
          </p>
        </div>
      )}

      {/* Import Wizard */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Importar dados</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Traga clientes, posts, entregas e ideias de Notion, Trello, ClickUp ou planilhas.
        </p>
        {/* Button + asChild rather than `className="btn-secondary"` on the Link:
            btn-secondary is the legacy style.css class, which renders a bare
            bordered box that matches nothing else on this screen. Every other
            action in this tab uses <Button>, so this one does too. */}
        <Button asChild>
          <Link to="/importar">Abrir assistente de importação</Link>
        </Button>
      </div>

      {/* Remove Logo Confirm */}
      <AlertDialog open={removeLogoOpen} onOpenChange={setRemoveLogoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover logo?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveLogo}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
