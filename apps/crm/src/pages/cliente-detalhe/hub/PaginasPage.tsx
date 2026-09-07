import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { getHubPages, upsertHubPage, removeHubPage, type HubPageRow } from '@/store';
import { HubRoleGate, useHubPortalDataEnabled } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

export default function PaginasPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  // Tri-state: só um `can('configuracoes','editar')` resolvido como `true` libera a
  // busca; 'unknown' (membership ainda carregando) mantém a query desligada.
  const canLoadPortalData = useHubPortalDataEnabled();
  // An agent never sees the pages data (HubRoleGate below withholds it) — don't fetch it
  // just to discard it at render.
  const { data: pages } = useQuery({
    queryKey: ['hub-pages-crm', clienteId],
    queryFn: () => getHubPages(clienteId),
    enabled: canLoadPortalData,
  });

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Páginas</h2>
          <p className="hub-page__sub">Páginas de conteúdo publicadas no portal do cliente.</p>
        </div>
      </header>
      <HubRoleGate>
        <PagesEditor
          clienteId={clienteId}
          contaId={cliente.conta_id}
          pages={pages ?? []}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })}
        />
      </HubRoleGate>
    </div>
  );
}

const mdComponents = {
  h1: (props: React.ComponentProps<'h1'>) => (
    <h1 {...props} className="text-2xl font-semibold text-foreground mt-6 mb-2" />
  ),
  h2: (props: React.ComponentProps<'h2'>) => (
    <h2 {...props} className="text-xl font-semibold text-foreground mt-5 mb-2" />
  ),
  h3: (props: React.ComponentProps<'h3'>) => (
    <h3 {...props} className="text-lg font-semibold text-foreground mt-4 mb-1.5" />
  ),
  p: (props: React.ComponentProps<'p'>) => (
    <p {...props} className="text-sm text-muted-foreground leading-relaxed mb-3" />
  ),
  strong: (props: React.ComponentProps<'strong'>) => (
    <strong {...props} className="font-semibold text-foreground" />
  ),
  a: (props: React.ComponentProps<'a'>) => (
    <a {...props} className="text-primary underline underline-offset-2" />
  ),
  img: (props: React.ComponentProps<'img'>) => (
    <img {...props} className="rounded-lg max-w-full my-3 border border-border" />
  ),
  ul: (props: React.ComponentProps<'ul'>) => (
    <ul {...props} className="list-disc pl-5 mb-3 text-sm text-muted-foreground leading-relaxed" />
  ),
  ol: (props: React.ComponentProps<'ol'>) => (
    <ol
      {...props}
      className="list-decimal pl-5 mb-3 text-sm text-muted-foreground leading-relaxed"
    />
  ),
  li: (props: React.ComponentProps<'li'>) => <li {...props} className="mb-0.5" />,
  blockquote: (props: React.ComponentProps<'blockquote'>) => (
    <blockquote
      {...props}
      className="border-l-4 border-border pl-3 my-3 text-muted-foreground italic text-sm"
    />
  ),
  code: ({ className, children, ...props }: React.ComponentProps<'code'>) => {
    const isBlock = className?.includes('language-');
    return isBlock ? (
      <code
        {...props}
        className={`${className ?? ''} block bg-muted text-foreground rounded-lg p-3 my-3 text-xs overflow-x-auto`}
      >
        {children}
      </code>
    ) : (
      <code {...props} className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
        {children}
      </code>
    );
  },
  pre: (props: React.ComponentProps<'pre'>) => (
    <pre
      {...props}
      className="bg-muted text-foreground rounded-lg p-3 my-3 text-xs overflow-x-auto"
    />
  ),
  hr: (props: React.ComponentProps<'hr'>) => <hr {...props} className="my-5 border-border" />,
  table: (props: React.ComponentProps<'table'>) => (
    <div className="overflow-x-auto my-3">
      <table {...props} className="w-full text-sm text-muted-foreground border-collapse" />
    </div>
  ),
  th: (props: React.ComponentProps<'th'>) => (
    <th
      {...props}
      className="border border-border px-2 py-1.5 bg-muted font-semibold text-left text-xs text-foreground"
    />
  ),
  td: (props: React.ComponentProps<'td'>) => (
    <td {...props} className="border border-border px-2 py-1.5 text-xs" />
  ),
};

function PagesEditor({
  clienteId,
  contaId,
  pages,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  pages: HubPageRow[];
  onSaved: () => void;
}) {
  const [editingPage, setEditingPage] = useState<Partial<HubPageRow> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const contentText =
    (editingPage?.content as Array<{ content: string }> | undefined)?.[0]?.content ?? '';
  const isDirty = editingPage != null && (editingPage.title ?? '') !== '';

  async function savePage() {
    if (!editingPage?.title) return;
    setSaving(true);
    try {
      await upsertHubPage({
        ...editingPage,
        cliente_id: clienteId,
        conta_id: contaId,
        content: editingPage.content ?? [],
      });
      toast.success('Página salva!');
      setEditingPage(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(id: string) {
    try {
      await removeHubPage(id);
      toast.success('Página removida.');
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover página.');
    }
  }

  function closeEditor() {
    setEditingPage(null);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Páginas</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditingPage({ title: '', content: [] })}
        >
          <Plus size={14} className="mr-1.5" /> Nova página
        </Button>
      </div>

      <div className="space-y-2">
        {pages.map((p) => (
          <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
            <span className="text-sm font-medium">{p.title}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditingPage(p)}>
                <Pencil size={14} className="mr-1" /> Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => deletePage(p.id)}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={editingPage != null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent
          className="max-w-5xl w-[95vw] h-[85vh] flex flex-col"
          confirmClose={isDirty}
          onConfirmClose={closeEditor}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{editingPage?.id ? 'Editar página' : 'Nova página'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 flex-1 flex flex-col min-h-0">
            <Input
              value={editingPage?.title ?? ''}
              onChange={(e) => setEditingPage((p) => ({ ...p!, title: e.target.value }))}
              placeholder="Título da página"
            />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Markdown</span>
              <button
                type="button"
                className={`px-2 py-0.5 rounded text-xs transition-colors ${showPreview ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? 'Preview on' : 'Preview off'}
              </button>
            </div>

            <div className="hub-page-editor__workspace flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
              <textarea
                className={`hub-page-editor__input min-h-[12rem] flex-1 resize-none rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${showPreview ? 'w-full md:w-1/2' : 'w-full'}`}
                style={{ height: '100%' }}
                value={contentText}
                onChange={(e) =>
                  setEditingPage((p) => ({
                    ...p!,
                    content: [{ type: 'markdown', content: e.target.value }],
                  }))
                }
                placeholder="Escreva o conteúdo em markdown..."
              />
              {showPreview && (
                <div className="hub-page-editor__preview min-h-[12rem] w-full flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 md:w-1/2">
                  {contentText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {contentText}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Preview aparecerá aqui...
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>
              Cancelar
            </Button>
            <Button onClick={savePage} disabled={saving || !editingPage?.title}>
              <Save size={14} className="mr-1.5" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
