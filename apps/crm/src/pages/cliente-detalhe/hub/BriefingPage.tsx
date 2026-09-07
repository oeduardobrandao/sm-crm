import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { openCSVSelector } from '@/lib/csv';
import {
  buildBriefingExportSections,
  briefingToCSV,
  briefingToMarkdown,
  slugifyTitle,
} from '@/lib/briefingExport';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Plus,
  Trash2,
  Save,
  Upload,
  Download,
  HelpCircle,
  Pencil,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { ScrollableTabs } from '@/components/shared/ScrollableTabs';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  getHubBriefingQuestions,
  addHubBriefingQuestion,
  updateHubBriefingQuestion,
  renameHubBriefingSection,
  deleteHubBriefingQuestion,
  getBriefings,
  addBriefing,
  updateBriefingTitle,
  deleteBriefing,
  reorderBriefingQuestions,
  getBriefingTemplates,
  applyTemplateToClient,
  type HubBriefingQuestionRow,
  type BriefingRow,
} from '@/store';
import { BriefingTemplatesModal } from '../BriefingTemplatesModal';
import { BriefingAudioPlayer } from '../BriefingAudioPlayer';
import { SortableQuestion, SortableSection, SECTION_PREFIX } from '../BriefingReorder';
import {
  reorderQuestionWithinSection,
  reorderSections,
  toDisplayOrderUpdates,
  applyReorderToCache,
} from '@/lib/briefingReorder';
import { HubRoleGate } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

function downloadTextFile(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function BriefingPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Briefing</h2>
          <p className="hub-page__sub">
            Perguntas para orientar a produção de conteúdo do cliente.
          </p>
        </div>
      </header>
      <HubRoleGate>
        <BriefingEditor
          clienteId={clienteId}
          contaId={cliente.conta_id}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] })}
        />
      </HubRoleGate>
    </div>
  );
}

function BriefingEditor({
  clienteId,
  contaId,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data: briefings = [] } = useQuery({
    queryKey: ['briefings', clienteId],
    queryFn: () => getBriefings(clienteId),
  });
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['hub-briefing-questions', clienteId],
    queryFn: () => getHubBriefingQuestions(clienteId),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingSectionName, setEditingSectionName] = useState<string | null>(null);
  const [sectionNameText, setSectionNameText] = useState('');
  const [savingSectionName, setSavingSectionName] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [addingSectionInput, setAddingSectionInput] = useState(false);
  const [newQuestions, setNewQuestions] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const { data: templates = [] } = useQuery({
    queryKey: ['briefing-templates'],
    queryFn: getBriefingTemplates,
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  // Sections are collapsed by default; this tracks which ones the user has expanded.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Default selection: first briefing once loaded (or when the selected one is deleted).
  useEffect(() => {
    if (briefings.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !briefings.find((b) => b.id === selectedId)) {
      setSelectedId(briefings[0].id);
    }
  }, [briefings, selectedId]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['briefings', clienteId] });
    qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] });
    onSaved();
  }

  // Coalesce legacy null-briefing_id questions into the first briefing.
  const firstId = briefings[0]?.id ?? null;
  const briefingQuestions = questions.filter((q) => (q.briefing_id ?? firstId) === selectedId);

  // ── Drag-and-drop reordering ────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persistReorder(orderedIds: string[] | null) {
    if (!orderedIds) return;
    const updates = toDisplayOrderUpdates(briefingQuestions, orderedIds);
    if (updates.length === 0) return;
    const key = ['hub-briefing-questions', clienteId];
    // Cancel in-flight refetches so they can't clobber the optimistic order.
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData<HubBriefingQuestionRow[]>(key, (old) =>
      old ? applyReorderToCache(old, orderedIds) : old,
    );
    try {
      await reorderBriefingQuestions(updates);
      qc.invalidateQueries({ queryKey: key });
    } catch {
      toast.error('Erro ao reordenar.');
      qc.invalidateQueries({ queryKey: key });
    }
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = String(active.id).slice(SECTION_PREFIX.length);
    const to = String(over.id).slice(SECTION_PREFIX.length);
    void persistReorder(reorderSections(briefingQuestions, from, to));
  }

  function handleQuestionDragEnd(sectionKey: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void persistReorder(
      reorderQuestionWithinSection(
        briefingQuestions,
        sectionKey,
        String(active.id),
        String(over.id),
      ),
    );
  }

  async function handleCreateBriefing() {
    try {
      const b = await addBriefing(clienteId, contaId, 'Novo briefing');
      // Seed the cache so the default-selection effect finds the new briefing
      // synchronously; otherwise it can't match selectedId against the stale
      // list and snaps selection back to the first briefing.
      qc.setQueryData<BriefingRow[]>(['briefings', clienteId], (old) => [...(old ?? []), b]);
      setSelectedId(b.id);
      setRenaming(true);
      setRenameText(b.title);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao criar briefing.');
    }
  }

  async function handleRenameBriefing() {
    if (!selectedId || !renameText.trim()) return;
    try {
      await updateBriefingTitle(selectedId, renameText.trim());
      setRenaming(false);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao renomear briefing.');
    }
  }

  async function handleDeleteBriefing() {
    if (!selectedId) return;
    if (
      !window.confirm(
        'Remover este briefing e todas as suas perguntas? Essa ação não pode ser desfeita.',
      )
    )
      return;
    try {
      await deleteBriefing(selectedId);
      setSelectedId(null);
      refresh();
      toast.success('Briefing removido.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover briefing.');
    }
  }

  function handleCSVImport() {
    if (!selectedId) {
      toast.error('Crie ou selecione um briefing primeiro.');
      return;
    }
    const briefingId = selectedId;
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.pergunta) continue;
          try {
            await addHubBriefingQuestion(
              clienteId,
              contaId,
              briefingId,
              row.pergunta.trim(),
              row.secao?.trim() || null,
              row.resposta?.trim() || null,
            );
            count++;
          } catch {
            /* skip row */
          }
        }
        if (count > 0) {
          toast.success(
            `${count} pergunta${count !== 1 ? 's' : ''} importada${count !== 1 ? 's' : ''} com sucesso!`,
          );
          refresh();
        } else {
          toast.error('Nenhuma pergunta válida encontrada. Verifique a coluna "pergunta".');
        }
        setImportingCsv(false);
      },
      (err) => {
        setImportingCsv(false);
        toast.error(err.message);
      },
      () => setImportingCsv(true),
    );
  }

  async function handleApplyTemplate(templateId: string) {
    setApplying(true);
    try {
      const b = await applyTemplateToClient(clienteId, contaId, templateId);
      qc.setQueryData<BriefingRow[]>(['briefings', clienteId], (old) => [...(old ?? []), b]);
      setSelectedId(b.id);
      refresh();
      toast.success('Template aplicado! Ajuste as perguntas como quiser.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao aplicar template.');
    } finally {
      setApplying(false);
    }
  }

  // Build ordered list of sections within the selected briefing.
  const sections: { name: string; questions: HubBriefingQuestionRow[] }[] = [];
  for (const q of briefingQuestions) {
    const name = q.section ?? '';
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(q);
    else sections.push({ name, questions: [q] });
  }
  const unsectioned = sections.find((s) => s.name === '');
  const namedSections = sections.filter((s) => s.name !== '');

  async function handleAddQuestion(section: string | null) {
    if (!selectedId) return;
    const key = section ?? '';
    const text = (newQuestions[key] ?? '').trim();
    if (!text) return;
    setAddingFor(key);
    try {
      await addHubBriefingQuestion(clienteId, contaId, selectedId, text, section);
      setNewQuestions((prev) => ({ ...prev, [key]: '' }));
      refresh();
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
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar pergunta.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHubBriefingQuestion(id);
      refresh();
      toast.success('Pergunta removida.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover pergunta.');
    }
  }

  async function handleRenameSection(section: {
    name: string;
    questions: HubBriefingQuestionRow[];
  }) {
    const nextName = sectionNameText.trim();
    if (!nextName || savingSectionName) return;
    if (nextName === section.name) {
      setEditingSectionName(null);
      return;
    }
    if (namedSections.some((candidate) => candidate.name === nextName)) {
      toast.error('Já existe uma seção com esse nome.');
      return;
    }

    setSavingSectionName(true);
    try {
      await renameHubBriefingSection(
        section.questions.map((question) => question.id),
        nextName,
      );
      setExpandedSections((prev) => {
        if (!prev.has(section.name)) return prev;
        const next = new Set(prev);
        next.delete(section.name);
        next.add(nextName);
        return next;
      });
      setNewQuestions((prev) => {
        if (!(section.name in prev)) return prev;
        const next = { ...prev, [nextName]: prev[section.name] };
        delete next[section.name];
        return next;
      });
      setEditingSectionName(null);
      refresh();
      toast.success('Seção renomeada.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao renomear seção.');
    } finally {
      setSavingSectionName(false);
    }
  }

  function handleAddSection() {
    const name = newSectionName.trim();
    if (!name) return;
    setNewSectionName('');
    setAddingSectionInput(false);
    setNewQuestions((prev) => ({ ...prev, [name]: '' }));
  }

  function toggleSection(name: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllSections() {
    const allExpanded =
      namedSections.length > 0 && namedSections.every((s) => expandedSections.has(s.name));
    setExpandedSections(allExpanded ? new Set() : new Set(namedSections.map((s) => s.name)));
  }

  if (isLoading)
    return (
      <div className="py-8 flex justify-center">
        <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );

  const pendingSections = Object.keys(newQuestions).filter(
    (k) => k !== '' && !namedSections.find((s) => s.name === k),
  );

  function renderQuestions(sectionQuestions: HubBriefingQuestionRow[], sectionKey: string | null) {
    return (
      <div className="space-y-2 mb-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleQuestionDragEnd(sectionKey ?? '', e)}
        >
          <SortableContext
            items={sectionQuestions.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            {sectionQuestions.map((q) => (
              <SortableQuestion key={q.id} id={q.id} disabled={editingId === q.id}>
                <div className="border rounded-lg p-3">
                  {editingId === q.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(q.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveEdit(q.id)}>
                          <Save size={14} className="mr-1.5" /> Salvar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{q.question}</p>
                        {q.answer ? (
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                            {q.answer}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            Sem resposta ainda
                          </p>
                        )}
                        <BriefingAudioPlayer question={q} />
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(q.id);
                            setEditText(q.question);
                          }}
                        >
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(q.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </SortableQuestion>
            ))}
          </SortableContext>
        </DndContext>
        <div className="flex gap-2">
          <Input
            value={newQuestions[sectionKey ?? ''] ?? ''}
            onChange={(e) =>
              setNewQuestions((prev) => ({ ...prev, [sectionKey ?? '']: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddQuestion(sectionKey);
            }}
            placeholder="Nova pergunta..."
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => handleAddQuestion(sectionKey)}
            disabled={
              addingFor === (sectionKey ?? '') || !(newQuestions[sectionKey ?? ''] ?? '').trim()
            }
          >
            <Plus size={14} className="mr-1.5" /> Adicionar
          </Button>
        </div>
      </div>
    );
  }

  const selectedBriefing = briefings.find((b) => b.id === selectedId) ?? null;

  const canExport = !!selectedBriefing && briefingQuestions.length > 0;

  async function handleCopyMarkdown() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    const md = briefingToMarkdown(selectedBriefing?.title ?? '', sections);
    try {
      await navigator.clipboard.writeText(md);
      toast.success('Briefing copiado como Markdown!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  async function handleCopyCSV() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    try {
      await navigator.clipboard.writeText(briefingToCSV(sections));
      toast.success('Briefing copiado como CSV!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  function handleDownloadCSV() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    const csv = '﻿' + briefingToCSV(sections); // BOM so Excel reads accents
    downloadTextFile(
      `briefing-${slugifyTitle(selectedBriefing?.title ?? '')}.csv`,
      'text/csv;charset=utf-8',
      csv,
    );
    toast.success('CSV exportado!');
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold">Briefings</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleCreateBriefing}>
            <Plus size={14} className="mr-1.5" /> Novo briefing
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={applying || templates.length === 0}>
                Usar template <ChevronDown size={14} className="ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {templates.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => handleApplyTemplate(t.id)}>
                  {t.title} ({(t.questions ?? []).length})
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCSVImport}
            disabled={!selectedId || importingCsv}
          >
            <Upload size={14} className="mr-1.5" /> Importar CSV
          </Button>
          <span
            data-tooltip="Colunas: pergunta*, secao, resposta"
            data-tooltip-dir="bottom"
            style={{ display: 'flex' }}
          >
            <HelpCircle className="h-4 w-4 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!canExport}>
                <Download size={14} className="mr-1.5" /> Exportar
                <ChevronDown size={14} className="ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyMarkdown}>
                <Copy size={14} className="mr-2" /> Copiar como Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyCSV}>
                <Copy size={14} className="mr-2" /> Copiar como CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadCSV}>
                <Download size={14} className="mr-2" /> Baixar CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {importingCsv && (
        <div className="csv-progress mb-3" role="progressbar" aria-label="Importando CSV" />
      )}

      {/* Briefing tabs */}
      {briefings.length > 0 && (
        <ScrollableTabs label="Briefings" activeKey={selectedId} className="mb-4">
          {briefings.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={selectedId === b.id}
              data-active={selectedId === b.id}
              onClick={() => {
                setSelectedId(b.id);
                setRenaming(false);
                setNewQuestions({});
                setAddingSectionInput(false);
                setEditingId(null);
                setEditingSectionName(null);
                setExpandedSections(new Set());
              }}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                selectedId === b.id
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {b.title || <span className="italic opacity-60">Sem título</span>}
            </button>
          ))}
        </ScrollableTabs>
      )}

      {!selectedBriefing ? (
        <p className="text-sm text-muted-foreground py-6">
          Nenhum briefing ainda. Crie um com "Novo briefing".
        </p>
      ) : (
        <>
          {/* Selected briefing header: rename / delete */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {renaming ? (
              <div className="flex gap-2 flex-1">
                <Input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameBriefing();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  autoFocus
                  className="flex-1"
                />
                <Button size="sm" onClick={handleRenameBriefing}>
                  <Save size={14} className="mr-1.5" /> Salvar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRenaming(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold">
                  {selectedBriefing.title || (
                    <span className="font-normal italic text-muted-foreground">Sem título</span>
                  )}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenaming(true);
                      setRenameText(selectedBriefing.title);
                    }}
                  >
                    <Pencil size={14} className="mr-1.5" /> Renomear
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDeleteBriefing}
                    aria-label="Remover briefing"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Unsectioned questions */}
          {(unsectioned || namedSections.length === 0) && (
            <div className="mb-6">{renderQuestions(unsectioned?.questions ?? [], null)}</div>
          )}

          {/* Expand/collapse all (sections are collapsed by default) */}
          {namedSections.length > 1 && (
            <div className="flex justify-end -mt-2 mb-2">
              <button
                type="button"
                onClick={toggleAllSections}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {namedSections.every((s) => expandedSections.has(s.name))
                  ? 'Recolher tudo'
                  : 'Expandir tudo'}
              </button>
            </div>
          )}

          {/* Named sections (collapsible, drag to reorder) */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSectionDragEnd}
          >
            <SortableContext
              items={namedSections.map((s) => SECTION_PREFIX + s.name)}
              strategy={verticalListSortingStrategy}
            >
              {namedSections.map((s) => {
                const isCollapsed = !expandedSections.has(s.name);
                const isEditingSection = editingSectionName === s.name;
                return (
                  <SortableSection
                    key={s.name}
                    id={SECTION_PREFIX + s.name}
                    header={
                      isEditingSection ? (
                        <div className="flex flex-1 items-center gap-2">
                          <Input
                            value={sectionNameText}
                            onChange={(e) => setSectionNameText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleRenameSection(s);
                              if (e.key === 'Escape') setEditingSectionName(null);
                            }}
                            aria-label="Nome da seção"
                            className="h-8 flex-1"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => void handleRenameSection(s)}
                            disabled={!sectionNameText.trim() || savingSectionName}
                          >
                            <Save size={14} className="mr-1.5" /> Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingSectionName(null)}
                            disabled={savingSectionName}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleSection(s.name)}
                            aria-expanded={!isCollapsed}
                            className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            <span className="truncate">{s.name}</span>
                            <span className="font-normal normal-case opacity-60">
                              ({s.questions.length})
                            </span>
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Renomear seção ${s.name}`}
                            onClick={() => {
                              setEditingSectionName(s.name);
                              setSectionNameText(s.name);
                            }}
                          >
                            <Pencil size={14} />
                          </Button>
                        </div>
                      )
                    }
                  >
                    {!isCollapsed && renderQuestions(s.questions, s.name)}
                  </SortableSection>
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Pending (not yet saved) sections */}
          {pendingSections.map((name) => (
            <div key={name} className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {name}
              </p>
              {renderQuestions([], name)}
            </div>
          ))}

          {/* Add section */}
          {addingSectionInput ? (
            <div className="flex gap-2 mt-2">
              <Input
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSection();
                  if (e.key === 'Escape') {
                    setAddingSectionInput(false);
                    setNewSectionName('');
                  }
                }}
                placeholder="Nome da seção..."
                className="flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleAddSection} disabled={!newSectionName.trim()}>
                Criar seção
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingSectionInput(false);
                  setNewSectionName('');
                }}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddingSectionInput(true)}>
              <Plus size={14} className="mr-1.5" /> Nova seção
            </Button>
          )}
        </>
      )}
      <BriefingTemplatesModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </section>
  );
}
