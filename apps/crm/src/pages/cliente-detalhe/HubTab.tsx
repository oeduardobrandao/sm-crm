import { useState, useEffect } from 'react';
import { openCSVSelector } from '@/lib/csv';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, ToggleLeft, ToggleRight, Plus, Trash2, Save, Upload, HelpCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  getHubToken, createHubToken, setHubTokenActive,
  getHubBrand, upsertHubBrand,
  getHubPages, upsertHubPage, removeHubPage,
  getHubBriefingQuestions, addHubBriefingQuestion, updateHubBriefingQuestion, deleteHubBriefingQuestion, updateHubBriefingQuestionSection,
  getIdeias, type Ideia,
  type HubBrandRow, type HubBrandFileRow, type HubPageRow, type HubBriefingQuestionRow,
} from '@/store';
import { IdeiaDrawer } from '@/components/ideias/IdeiaDrawer';
import { IdeiaStatusBadge } from '@/components/ideias/IdeiaStatusBadge';

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
    <Tabs defaultValue="acesso" className="py-4">
      <TabsList className="mb-6">
        <TabsTrigger value="acesso">Acesso</TabsTrigger>
        <TabsTrigger value="briefing">Briefing</TabsTrigger>
        <TabsTrigger value="marca">Marca</TabsTrigger>
        <TabsTrigger value="paginas">Páginas</TabsTrigger>
        <TabsTrigger value="ideias">Ideias</TabsTrigger>
      </TabsList>

      <TabsContent value="acesso">
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
      </TabsContent>

      <TabsContent value="briefing">
        <BriefingEditor
          clienteId={clienteId}
          contaId={contaId}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] })}
        />
      </TabsContent>

      <TabsContent value="marca">
        <BrandEditor
          clienteId={clienteId}
          brand={brandData?.brand ?? null}
          files={brandData?.files ?? []}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-brand-crm', clienteId] })}
        />
      </TabsContent>

      <TabsContent value="paginas">
        <PagesEditor
          clienteId={clienteId}
          contaId={contaId}
          pages={pages ?? []}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })}
        />
      </TabsContent>

      <TabsContent value="ideias">
        <IdeiasTab clienteId={clienteId} />
      </TabsContent>
    </Tabs>
  );
}

function BrandEditor({ clienteId, brand, files, onSaved }: { clienteId: number; brand: HubBrandRow | null; files: HubBrandFileRow[]; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<HubBrandRow>>(brand ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brand) setForm(brand);
  }, [brand]);

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

const mdComponents = {
  h1: (props: React.ComponentProps<'h1'>) => <h1 {...props} className="text-2xl font-semibold text-foreground mt-6 mb-2" />,
  h2: (props: React.ComponentProps<'h2'>) => <h2 {...props} className="text-xl font-semibold text-foreground mt-5 mb-2" />,
  h3: (props: React.ComponentProps<'h3'>) => <h3 {...props} className="text-lg font-semibold text-foreground mt-4 mb-1.5" />,
  p: (props: React.ComponentProps<'p'>) => <p {...props} className="text-sm text-muted-foreground leading-relaxed mb-3" />,
  strong: (props: React.ComponentProps<'strong'>) => <strong {...props} className="font-semibold text-foreground" />,
  a: (props: React.ComponentProps<'a'>) => <a {...props} className="text-primary underline underline-offset-2" />,
  img: (props: React.ComponentProps<'img'>) => <img {...props} className="rounded-lg max-w-full my-3 border border-border" />,
  ul: (props: React.ComponentProps<'ul'>) => <ul {...props} className="list-disc pl-5 mb-3 text-sm text-muted-foreground leading-relaxed" />,
  ol: (props: React.ComponentProps<'ol'>) => <ol {...props} className="list-decimal pl-5 mb-3 text-sm text-muted-foreground leading-relaxed" />,
  li: (props: React.ComponentProps<'li'>) => <li {...props} className="mb-0.5" />,
  blockquote: (props: React.ComponentProps<'blockquote'>) => <blockquote {...props} className="border-l-4 border-border pl-3 my-3 text-muted-foreground italic text-sm" />,
  code: ({ className, children, ...props }: React.ComponentProps<'code'>) => {
    const isBlock = className?.includes('language-');
    return isBlock
      ? <code {...props} className={`${className ?? ''} block bg-muted text-foreground rounded-lg p-3 my-3 text-xs overflow-x-auto`}>{children}</code>
      : <code {...props} className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">{children}</code>;
  },
  pre: (props: React.ComponentProps<'pre'>) => <pre {...props} className="bg-muted text-foreground rounded-lg p-3 my-3 text-xs overflow-x-auto" />,
  hr: (props: React.ComponentProps<'hr'>) => <hr {...props} className="my-5 border-border" />,
  table: (props: React.ComponentProps<'table'>) => <div className="overflow-x-auto my-3"><table {...props} className="w-full text-sm text-muted-foreground border-collapse" /></div>,
  th: (props: React.ComponentProps<'th'>) => <th {...props} className="border border-border px-2 py-1.5 bg-muted font-semibold text-left text-xs text-foreground" />,
  td: (props: React.ComponentProps<'td'>) => <td {...props} className="border border-border px-2 py-1.5 text-xs" />,
};

function PagesEditor({ clienteId, contaId, pages, onSaved }: { clienteId: number; contaId: string; pages: HubPageRow[]; onSaved: () => void }) {
  const [editingPage, setEditingPage] = useState<Partial<HubPageRow> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const contentText = (editingPage?.content as Array<{ content: string }> | undefined)?.[0]?.content ?? '';
  const isDirty = editingPage != null && (editingPage.title ?? '') !== '';

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
        <Button size="sm" variant="outline" onClick={() => setEditingPage({ title: '', content: [] })}>
          <Plus size={14} className="mr-1.5" /> Nova página
        </Button>
      </div>

      <div className="space-y-2">
        {pages.map(p => (
          <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
            <span className="text-sm font-medium">{p.title}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditingPage(p)}><Pencil size={14} className="mr-1" /> Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => deletePage(p.id)}><Trash2 size={14} /></Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={editingPage != null} onOpenChange={open => { if (!open) closeEditor(); }}>
        <DialogContent
          className="max-w-5xl w-[95vw] h-[85vh] flex flex-col"
          confirmClose={isDirty}
          onConfirmClose={closeEditor}
        >
          <DialogHeader>
            <DialogTitle>{editingPage?.id ? 'Editar página' : 'Nova página'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 flex-1 flex flex-col min-h-0">
            <Input
              value={editingPage?.title ?? ''}
              onChange={e => setEditingPage(p => ({ ...p!, title: e.target.value }))}
              placeholder="Título da página"
            />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Markdown</span>
              <button
                type="button"
                className={`px-2 py-0.5 rounded text-xs transition-colors ${showPreview ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                onClick={() => setShowPreview(v => !v)}
              >
                {showPreview ? 'Preview on' : 'Preview off'}
              </button>
            </div>

            <div className={`flex-1 min-h-0 flex gap-3 ${showPreview ? '' : ''}`}>
              <textarea
                className={`border border-border bg-background text-foreground rounded-lg p-3 text-sm resize-none font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring ${showPreview ? 'w-1/2' : 'w-full'}`}
                style={{ height: '100%' }}
                value={contentText}
                onChange={e => setEditingPage(p => ({ ...p!, content: [{ type: 'markdown', content: e.target.value }] }))}
                placeholder="Escreva o conteúdo em markdown..."
              />
              {showPreview && (
                <div className="w-1/2 border rounded-lg p-4 overflow-y-auto bg-muted/30">
                  {contentText ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{contentText}</ReactMarkdown>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Preview aparecerá aqui...</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>Cancelar</Button>
            <Button onClick={savePage} disabled={saving || !editingPage?.title}>
              <Save size={14} className="mr-1.5" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BriefingEditor({ clienteId, contaId, onSaved }: { clienteId: number; contaId: string; onSaved: () => void }) {
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['hub-briefing-questions', clienteId],
    queryFn: () => getHubBriefingQuestions(clienteId),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSectionInput, setAddingSectionInput] = useState(false);
  // Map of section name -> new question text being typed
  const [newQuestions, setNewQuestions] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);

  function handleCSVImport() {
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.pergunta) continue;
          try {
            await addHubBriefingQuestion(clienteId, contaId, row.pergunta.trim(), row.secao?.trim() || null, row.resposta?.trim() || null);
            count++;
          } catch { /* skip row */ }
        }
        if (count > 0) {
          toast.success(`${count} pergunta${count !== 1 ? 's' : ''} importada${count !== 1 ? 's' : ''} com sucesso!`);
          onSaved();
        } else {
          toast.error('Nenhuma pergunta válida encontrada. Verifique a coluna "pergunta".');
        }
      },
      (err) => toast.error(err.message),
    );
  }

  // Build ordered list of sections (preserving insertion order)
  const sections: { name: string; questions: HubBriefingQuestionRow[] }[] = [];
  for (const q of questions) {
    const name = q.section ?? '';
    const existing = sections.find(s => s.name === name);
    if (existing) existing.questions.push(q);
    else sections.push({ name, questions: [q] });
  }
  // Put unsectioned questions (section='') first if they exist
  const unsectioned = sections.find(s => s.name === '');
  const namedSections = sections.filter(s => s.name !== '');

  async function handleAddQuestion(section: string | null) {
    const key = section ?? '';
    const text = (newQuestions[key] ?? '').trim();
    if (!text) return;
    setAddingFor(key);
    try {
      await addHubBriefingQuestion(clienteId, contaId, text, section);
      setNewQuestions(prev => ({ ...prev, [key]: '' }));
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao adicionar pergunta.');
    } finally {
      setAddingFor(null);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editText.trim()) return;
    try {
      await updateHubBriefingQuestion(id, editText.trim());
      setEditingId(null);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar pergunta.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHubBriefingQuestion(id);
      onSaved();
      toast.success('Pergunta removida.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover pergunta.');
    }
  }

  async function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) return;
    // Section is created implicitly when first question is added to it.
    // We just add a placeholder question slot by tracking the section name.
    // Actually: just persist an empty section by adding it to local state only — no DB row yet.
    // The section is created when the user adds a question to it.
    setNewSectionName('');
    setAddingSectionInput(false);
    // Add to namedSections tracking via a new question slot
    setNewQuestions(prev => ({ ...prev, [name]: '' }));
    // Signal that this section exists (we'll render it from newQuestions keys)
  }

  if (isLoading) return <div className="py-8 flex justify-center"><div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" /></div>;

  // Pending sections (typed but not yet saved to DB)
  const pendingSections = Object.keys(newQuestions).filter(
    k => k !== '' && !namedSections.find(s => s.name === k)
  );

  function renderQuestions(sectionQuestions: HubBriefingQuestionRow[], sectionKey: string | null) {
    return (
      <div className="space-y-2 mb-3">
        {sectionQuestions.map(q => (
          <div key={q.id} className="border rounded-lg p-3">
            {editingId === q.id ? (
              <div className="space-y-2">
                <Input
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(q.id); if (e.key === 'Escape') setEditingId(null); }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleSaveEdit(q.id)}><Save size={14} className="mr-1.5" /> Salvar</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{q.question}</p>
                  {q.answer ? (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{q.answer}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1 italic">Sem resposta ainda</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(q.id); setEditText(q.question); }}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(q.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newQuestions[sectionKey ?? ''] ?? ''}
            onChange={e => setNewQuestions(prev => ({ ...prev, [sectionKey ?? '']: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleAddQuestion(sectionKey); }}
            placeholder="Nova pergunta..."
            className="flex-1"
          />
          <Button size="sm" onClick={() => handleAddQuestion(sectionKey)} disabled={addingFor === (sectionKey ?? '') || !(newQuestions[sectionKey ?? ''] ?? '').trim()}>
            <Plus size={14} className="mr-1.5" /> Adicionar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Briefing</h3>
        <div className="flex items-center gap-2">
          <span data-tooltip="Colunas: pergunta*, secao, resposta" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
          <Button size="sm" variant="outline" onClick={handleCSVImport}>
            <Upload size={14} className="mr-1.5" /> Importar CSV
          </Button>
        </div>
      </div>

      {/* Unsectioned questions */}
      {(unsectioned || namedSections.length === 0) && (
        <div className="mb-6">
          {renderQuestions(unsectioned?.questions ?? [], null)}
        </div>
      )}

      {/* Named sections */}
      {namedSections.map(s => (
        <div key={s.name} className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{s.name}</p>
          {renderQuestions(s.questions, s.name)}
        </div>
      ))}

      {/* Pending (not yet saved) sections */}
      {pendingSections.map(name => (
        <div key={name} className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{name}</p>
          {renderQuestions([], name)}
        </div>
      ))}

      {/* Add section */}
      {addingSectionInput ? (
        <div className="flex gap-2 mt-2">
          <Input
            value={newSectionName}
            onChange={e => setNewSectionName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddSection(); if (e.key === 'Escape') { setAddingSectionInput(false); setNewSectionName(''); } }}
            placeholder="Nome da seção..."
            className="flex-1"
            autoFocus
          />
          <Button size="sm" onClick={handleAddSection} disabled={!newSectionName.trim()}>Criar seção</Button>
          <Button size="sm" variant="outline" onClick={() => { setAddingSectionInput(false); setNewSectionName(''); }}>Cancelar</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAddingSectionInput(true)}>
          <Plus size={14} className="mr-1.5" /> Nova seção
        </Button>
      )}
    </section>
  );
}

function IdeiasTab({ clienteId }: { clienteId: number }) {
  const queryKey = ['hub-ideias-crm', clienteId];
  const { data: ideias = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getIdeias({ cliente_id: clienteId }),
  });

  const [selectedIdeia, setSelectedIdeia] = useState<Ideia | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = statusFilter === 'all' ? ideias : ideias.filter(i => i.status === statusFilter);

  if (isLoading) {
    return <div className="py-8 flex justify-center"><div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Ideias do cliente</h3>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-2 py-1 outline-none bg-background text-foreground"
        >
          <option value="all">Todos os status</option>
          <option value="nova">Nova</option>
          <option value="em_analise">Em análise</option>
          <option value="aprovada">Aprovada</option>
          <option value="descartada">Descartada</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Nenhuma ideia encontrada.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(ideia => (
            <button
              key={ideia.id}
              onClick={() => setSelectedIdeia(ideia)}
              className="w-full text-left border rounded-lg p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <IdeiaStatusBadge status={ideia.status} />
                    {ideia.ideia_reactions.length > 0 && (
                      <span className="text-xs text-muted-foreground">{ideia.ideia_reactions.length} reação(ões)</span>
                    )}
                    {ideia.comentario_agencia && (
                      <span className="text-xs text-muted-foreground">com resposta</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{ideia.titulo}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{ideia.descricao}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(ideia.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedIdeia && (
        <IdeiaDrawer
          ideia={selectedIdeia}
          queryKey={queryKey}
          onClose={() => setSelectedIdeia(null)}
        />
      )}
    </section>
  );
}
