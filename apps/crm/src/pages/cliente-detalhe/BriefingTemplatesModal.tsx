import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Star, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getBriefingTemplates,
  addBriefingTemplate,
  updateBriefingTemplate,
  removeBriefingTemplate,
  setDefaultBriefingTemplate,
  type BriefingTemplateRow,
  type BriefingTemplateQuestion,
} from '@/store';

export function BriefingTemplatesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ['briefing-templates'],
    queryFn: getBriefingTemplates,
  });

  // null = list view; 'new' = creating; otherwise editing an existing id.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<BriefingTemplateQuestion[]>([]);
  const [saving, setSaving] = useState(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefing-templates'] });
  }

  function startNew() {
    setEditing('new');
    setTitle('');
    setQuestions([]);
  }

  function startEdit(t: BriefingTemplateRow) {
    setEditing(t.id);
    setTitle(t.title);
    setQuestions(
      (t.questions ?? []).map((q) => ({ question: q.question, section: q.section ?? null })),
    );
  }

  function addRow() {
    setQuestions((prev) => [...prev, { question: '', section: null }]);
  }

  function updateRow(i: number, patch: Partial<BriefingTemplateQuestion>) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function removeRow(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast.error('Dê um título ao template.');
      return;
    }
    const cleanQuestions = questions
      .map((q) => ({ question: q.question.trim(), section: q.section?.trim() || null }))
      .filter((q) => q.question.length > 0);
    setSaving(true);
    try {
      if (editing === 'new') {
        await addBriefingTemplate({ title: cleanTitle, questions: cleanQuestions });
        toast.success('Template criado!');
      } else if (editing) {
        await updateBriefingTemplate(editing, { title: cleanTitle, questions: cleanQuestions });
        toast.success('Template atualizado!');
      }
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar template.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Remover este template? Essa ação não pode ser desfeita.')) return;
    try {
      await removeBriefingTemplate(id);
      refresh();
      toast.success('Template removido.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover template.');
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultBriefingTemplate(id);
      refresh();
      toast.success('Template padrão definido. Novos clientes começarão com ele.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao definir template padrão.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Templates de Briefing</DialogTitle>
        </DialogHeader>

        {editing === null ? (
          <div className="space-y-3">
            <Button size="sm" onClick={startNew}>
              <Plus size={14} className="mr-1.5" /> Novo template
            </Button>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum template ainda.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between border rounded-lg p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {t.title}
                        {t.is_default && (
                          <span className="ml-2 text-xs text-primary font-semibold">(padrão)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(t.questions ?? []).length} pergunta
                        {(t.questions ?? []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetDefault(t.id)}
                        title="Definir como padrão"
                      >
                        <Star
                          size={14}
                          className={t.is_default ? 'fill-primary text-primary' : ''}
                        />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(t)}
                        aria-label="Editar template"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(t.id)}
                        aria-label="Remover template"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do template (ex: Onboarding)"
            />
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={q.question}
                    onChange={(e) => updateRow(i, { question: e.target.value })}
                    placeholder="Pergunta..."
                    className="flex-1"
                  />
                  <Input
                    value={q.section ?? ''}
                    onChange={(e) => updateRow(i, { section: e.target.value })}
                    placeholder="Seção (opcional)"
                    className="w-40"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeRow(i)}
                    aria-label="Remover pergunta"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus size={14} className="mr-1.5" /> Adicionar pergunta
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save size={14} className="mr-1.5" /> Salvar template
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
