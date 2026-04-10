import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, ToggleLeft, ToggleRight, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getHubToken, createHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand,
  getHubPages, upsertHubPage, removeHubPage,
  type HubBrandRow, type HubBrandFileRow, type HubPageRow,
} from '@/store';

interface HubTabProps {
  clienteId: number;
  contaId: string;
  workspaceSlug: string;
}

export function HubTab({ clienteId, contaId, workspaceSlug }: HubTabProps) {
  const qc = useQueryClient();

  const { data: tokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
  });

  const { data: brandData } = useQuery({
    queryKey: ['hub-brand-crm', clienteId],
    queryFn: () => getHubBrand(clienteId),
  });

  const { data: pages } = useQuery({
    queryKey: ['hub-pages-crm', clienteId],
    queryFn: () => getHubPages(clienteId),
  });

  const hubUrl = tokenData ? `${window.location.origin}/${workspaceSlug}/hub/${tokenData.token}` : '';

  async function toggleActive() {
    if (!tokenData) return;
    await setHubTokenActive(tokenData.id, !tokenData.is_active);
    qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
    toast.success(tokenData.is_active ? 'Acesso desativado.' : 'Acesso reativado.');
  }

  async function copyLink() {
    await navigator.clipboard.writeText(hubUrl);
    toast.success('Link copiado!');
  }

  return (
    <div className="space-y-8 py-4">
      {/* Access control */}
      <section>
        <h3 className="font-semibold mb-3">Acesso do Cliente</h3>
        {tokenData ? (
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-xs bg-muted px-3 py-2 rounded-lg flex-1 min-w-0 truncate">{hubUrl}</code>
            <Button size="sm" variant="outline" onClick={copyLink}><Copy size={14} className="mr-1.5" /> Copiar</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(hubUrl, '_blank')}><Eye size={14} className="mr-1.5" /> Preview</Button>
            <Button size="sm" variant={tokenData.is_active ? 'destructive' : 'default'} onClick={toggleActive}>
              {tokenData.is_active ? <><ToggleRight size={14} className="mr-1.5" /> Desativar</> : <><ToggleLeft size={14} className="mr-1.5" /> Ativar</>}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">Nenhum link gerado ainda.</p>
            <Button size="sm" onClick={async () => {
              try {
                await createHubToken(clienteId, contaId);
                qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
                toast.success('Link gerado!');
              } catch (e: any) {
                toast.error(e.message ?? 'Erro ao gerar link.');
              }
            }}>
              <Plus size={14} className="mr-1.5" /> Gerar link
            </Button>
          </div>
        )}
      </section>

      {/* Brand center */}
      <BrandEditor
        clienteId={clienteId}
        brand={brandData?.brand ?? null}
        files={brandData?.files ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ['hub-brand-crm', clienteId] })}
      />

      {/* Custom pages */}
      <PagesEditor
        clienteId={clienteId}
        contaId={contaId}
        pages={pages ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })}
      />
    </div>
  );
}

function BrandEditor({ clienteId, brand, files, onSaved }: { clienteId: number; brand: HubBrandRow | null; files: HubBrandFileRow[]; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<HubBrandRow>>(brand ?? {});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsertHubBrand(clienteId, form);
      toast.success('Marca salva!');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h3 className="font-semibold mb-3">Marca</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>URL do Logo</Label>
          <Input value={form.logo_url ?? ''} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} placeholder="https://..." />
        </div>
        <div>
          <Label>Cor primária</Label>
          <Input value={form.primary_color ?? ''} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} placeholder="#000000" />
        </div>
        <div>
          <Label>Cor secundária</Label>
          <Input value={form.secondary_color ?? ''} onChange={e => setForm(f => ({ ...f, secondary_color: e.target.value }))} placeholder="#ffffff" />
        </div>
        <div>
          <Label>Fonte principal</Label>
          <Input value={form.font_primary ?? ''} onChange={e => setForm(f => ({ ...f, font_primary: e.target.value }))} placeholder="Inter" />
        </div>
        <div>
          <Label>Fonte secundária</Label>
          <Input value={form.font_secondary ?? ''} onChange={e => setForm(f => ({ ...f, font_secondary: e.target.value }))} placeholder="Playfair Display" />
        </div>
      </div>
      {files.length > 0 && (
        <div className="mt-3">
          <Label className="text-muted-foreground text-xs uppercase tracking-wide">Arquivos</Label>
          <div className="mt-1 space-y-1">
            {files.map(f => (
              <div key={f.id} className="text-sm text-muted-foreground">{f.name}</div>
            ))}
          </div>
        </div>
      )}
      <Button size="sm" className="mt-3" onClick={save} disabled={saving}><Save size={14} className="mr-1.5" /> Salvar marca</Button>
    </section>
  );
}

function PagesEditor({ clienteId, contaId, pages, onSaved }: { clienteId: number; contaId: string; pages: HubPageRow[]; onSaved: () => void }) {
  const [editingPage, setEditingPage] = useState<Partial<HubPageRow> | null>(null);
  const [saving, setSaving] = useState(false);

  async function savePage() {
    if (!editingPage?.title) return;
    setSaving(true);
    try {
      await upsertHubPage({ ...editingPage, cliente_id: clienteId, conta_id: contaId, content: editingPage.content ?? [] });
      toast.success('Página salva!');
      setEditingPage(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(id: string) {
    await removeHubPage(id);
    toast.success('Página removida.');
    onSaved();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Páginas</h3>
        <Button size="sm" variant="outline" onClick={() => setEditingPage({ title: '', content: [] })}>
          <Plus size={14} className="mr-1.5" /> Nova página
        </Button>
      </div>

      <div className="space-y-2">
        {pages.map(p => (
          <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
            <span className="text-sm font-medium">{p.title}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditingPage(p)}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => deletePage(p.id)}><Trash2 size={14} /></Button>
            </div>
          </div>
        ))}
      </div>

      {editingPage && (
        <div className="mt-4 border rounded-xl p-4 space-y-3">
          <div>
            <Label>Título da página</Label>
            <Input value={editingPage.title ?? ''} onChange={e => setEditingPage(p => ({ ...p!, title: e.target.value }))} placeholder="Ex: Manual de Comunicação" />
          </div>
          <div>
            <Label>Conteúdo (texto simples)</Label>
            <textarea
              className="w-full border rounded-lg p-2 text-sm resize-none min-h-[120px]"
              value={(editingPage.content as Array<{ content: string }> | undefined)?.[0]?.content ?? ''}
              onChange={e => setEditingPage(p => ({ ...p!, content: [{ type: 'paragraph', content: e.target.value }] }))}
              placeholder="Escreva o conteúdo da página..."
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={savePage} disabled={saving}><Save size={14} className="mr-1.5" /> Salvar</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingPage(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </section>
  );
}
