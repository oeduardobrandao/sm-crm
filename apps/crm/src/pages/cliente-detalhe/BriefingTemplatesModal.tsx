import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Star, Pencil, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { openCSVSelector } from '@/lib/csv';
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

export interface BriefingTemplateDraft {
  title: string;
  questions: BriefingTemplateQuestion[];
}

export function BriefingTemplatesModal({
  open,
  onOpenChange,
  initialDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre direto no editor de um template novo já preenchido (ex.: "Salvar como template"
   * a partir de um briefing). Sem ele, o modal abre na lista. */
  initialDraft?: BriefingTemplateDraft | null;
}) {
  const { t } = useTranslation('clientBriefing');
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
  const [importing, setImporting] = useState(false);

  // O modal fica montado entre aberturas: sem este reset, fechar no X um rascunho vindo
  // de "Salvar como template" faria o botão "Templates" reabrir aquele editor velho.
  useEffect(() => {
    if (!open) return;
    if (!initialDraft) {
      setEditing(null);
      return;
    }
    setEditing('new');
    setTitle(initialDraft.title);
    setQuestions(initialDraft.questions.map((q) => ({ ...q })));
  }, [open, initialDraft]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefing-templates'] });
  }

  function startNew() {
    setEditing('new');
    setTitle('');
    setQuestions([]);
  }

  function startEdit(tpl: BriefingTemplateRow) {
    setEditing(tpl.id);
    setTitle(tpl.title);
    setQuestions(
      (tpl.questions ?? []).map((q) => ({ question: q.question, section: q.section ?? null })),
    );
  }

  function handleImportCSV() {
    openCSVSelector(
      (rows) => {
        const imported = rows
          .filter((r) => r.pergunta && r.pergunta.trim())
          .map((r) => ({ question: r.pergunta.trim(), section: r.secao?.trim() || null }));
        setImporting(false);
        if (imported.length === 0) {
          toast.error(t('shared.noValidQuestions'));
          return;
        }
        setQuestions((prev) => [...prev, ...imported]);
        toast.success(t('templatesModal.imported', { count: imported.length }));
      },
      (err) => {
        setImporting(false);
        toast.error(err.message);
      },
      () => setImporting(true),
    );
  }

  function startNewFromCSV() {
    setEditing('new');
    setTitle('');
    setQuestions([]);
    handleImportCSV();
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
      toast.error(t('templatesModal.titleRequired'));
      return;
    }
    const cleanQuestions = questions
      .map((q) => ({ question: q.question.trim(), section: q.section?.trim() || null }))
      .filter((q) => q.question.length > 0);
    setSaving(true);
    try {
      if (editing === 'new') {
        await addBriefingTemplate({ title: cleanTitle, questions: cleanQuestions });
        toast.success(t('templatesModal.created'));
      } else if (editing) {
        await updateBriefingTemplate(editing, { title: cleanTitle, questions: cleanQuestions });
        toast.success(t('templatesModal.updated'));
      }
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? t('templatesModal.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('templatesModal.confirmRemove'))) return;
    try {
      await removeBriefingTemplate(id);
      refresh();
      toast.success(t('templatesModal.removed'));
    } catch (e: any) {
      toast.error(e.message ?? t('templatesModal.removeError'));
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultBriefingTemplate(id);
      refresh();
      toast.success(t('templatesModal.defaultSet'));
    } catch (e: any) {
      toast.error(e.message ?? t('templatesModal.defaultError'));
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
          <DialogTitle>{t('templatesModal.title')}</DialogTitle>
        </DialogHeader>

        {editing === null ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" onClick={startNew}>
                <Plus size={14} className="mr-1.5" /> {t('templatesModal.newTemplate')}
              </Button>
              <Button size="sm" variant="outline" onClick={startNewFromCSV}>
                <Upload size={14} className="mr-1.5" /> {t('templatesModal.newViaCsv')}
              </Button>
            </div>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">{t('templatesModal.empty')}</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between border rounded-lg p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {tpl.title}
                        {tpl.is_default && (
                          <span className="ml-2 text-xs text-primary font-semibold">
                            {t('templatesModal.defaultBadge')}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('templatesModal.questionCount', { count: (tpl.questions ?? []).length })}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetDefault(tpl.id)}
                        title={t('templatesModal.setDefault')}
                      >
                        <Star
                          size={14}
                          className={tpl.is_default ? 'fill-primary text-primary' : ''}
                        />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(tpl)}
                        aria-label={t('templatesModal.editTemplate')}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(tpl.id)}
                        aria-label={t('templatesModal.removeTemplate')}
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
              placeholder={t('templatesModal.titlePlaceholder')}
            />
            {importing && (
              <div
                className="csv-progress"
                role="progressbar"
                aria-label={t('shared.importingCsv')}
              />
            )}
            <div className="space-y-2">
              {questions.length > 0 && (
                <div className="flex gap-2 px-0.5">
                  <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('templatesModal.questionsHeader')}
                  </span>
                  <span className="w-40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('templatesModal.sectionsHeader')}
                  </span>
                  <span className="w-9 shrink-0" aria-hidden="true" />
                </div>
              )}
              {questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={q.question}
                    onChange={(e) => updateRow(i, { question: e.target.value })}
                    placeholder={t('templatesModal.questionPlaceholder')}
                    className="flex-1"
                  />
                  <Input
                    value={q.section ?? ''}
                    onChange={(e) => updateRow(i, { section: e.target.value })}
                    placeholder={t('templatesModal.sectionPlaceholder')}
                    className="w-40"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeRow(i)}
                    aria-label={t('shared.removeQuestion')}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={addRow}>
                  <Plus size={14} className="mr-1.5" /> {t('templatesModal.addQuestion')}
                </Button>
                <Button size="sm" variant="outline" onClick={handleImportCSV} disabled={importing}>
                  <Upload size={14} className="mr-1.5" /> {t('actions.importCsv')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('templatesModal.columnsHint')}
                </span>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save size={14} className="mr-1.5" /> {t('templatesModal.saveTemplate')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                {t('actions.cancel')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
