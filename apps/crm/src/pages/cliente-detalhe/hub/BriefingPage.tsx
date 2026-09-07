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

type BriefingFilter = 'todas' | 'sem-resposta' | 'respondidas';

/** Resposta vazia é resposta ausente: o cliente pode salvar string vazia pelo portal. */
export function isAnswered(q: { answer: string | null }): boolean {
  return q.answer != null && q.answer.trim() !== '';
}

/**
 * Âncora estável para o "clicar na seção rola até ela" do rail -- só precisa ser um id
 * de elemento HTML válido. Nenhum teste depende deste valor (o rail usa `data-testid`).
 */
function sectionAnchorId(name: string): string {
  return `hub-briefing-section-${name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()}`;
}

/** Agrupa por `section` (chave '' = sem seção), preservando a ordem de primeira
 * aparição -- mesma regra usada por `lib/briefingReorder.ts` para persistir a ordem. */
function groupIntoSections(
  list: HubBriefingQuestionRow[],
): { name: string; questions: HubBriefingQuestionRow[] }[] {
  const groups: { name: string; questions: HubBriefingQuestionRow[] }[] = [];
  for (const q of list) {
    const name = q.section ?? '';
    const existing = groups.find((g) => g.name === name);
    if (existing) existing.questions.push(q);
    else groups.push({ name, questions: [q] });
  }
  return groups;
}

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
  // Filtro por estado da resposta: chips com contagem no lugar do <select> (design
  // 2026-09-07). 'todas' é o padrão -- os chips e a barra de progresso sempre medem
  // o briefing inteiro, só a grade abaixo respeita o filtro.
  const [filter, setFilter] = useState<BriefingFilter>('todas');

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

  /** Reset transient per-briefing UI state when switching which briefing is selected. */
  function resetBriefingViewState() {
    setRenaming(false);
    setNewQuestions({});
    setAddingSectionInput(false);
    setEditingId(null);
    setEditingSectionName(null);
    setFilter('todas');
  }

  async function handleCreateBriefing() {
    try {
      const b = await addBriefing(clienteId, contaId, 'Novo briefing');
      // Seed the cache so the default-selection effect finds the new briefing
      // synchronously; otherwise it can't match selectedId against the stale
      // list and snaps selection back to the first briefing.
      qc.setQueryData<BriefingRow[]>(['briefings', clienteId], (old) => [...(old ?? []), b]);
      setSelectedId(b.id);
      setFilter('todas');
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
      setFilter('todas');
      refresh();
      toast.success('Template aplicado! Ajuste as perguntas como quiser.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao aplicar template.');
    } finally {
      setApplying(false);
    }
  }

  // Contagens: sempre sobre TODAS as perguntas do briefing selecionado, nunca sobre o
  // filtro ativo -- os chips e a barra de progresso medem o todo, o filtro só decide o
  // que a grade abaixo desenha.
  const totalCount = briefingQuestions.length;
  const answeredCount = briefingQuestions.filter(isAnswered).length;
  const unansweredCount = totalCount - answeredCount;

  function matchesFilter(q: HubBriefingQuestionRow): boolean {
    if (filter === 'sem-resposta') return !isAnswered(q);
    if (filter === 'respondidas') return isAnswered(q);
    return true;
  }
  const filteredQuestions = briefingQuestions.filter(matchesFilter);

  // Seções "de verdade" (a partir de TODAS as perguntas) -- usadas pelo índice do rail
  // e por qualquer checagem que precise saber o que existe de fato (seção pendente,
  // nome duplicado ao renomear), nunca pelo que o filtro está escondendo no momento.
  const allSections = groupIntoSections(briefingQuestions);
  const allNamedSections = allSections.filter((s) => s.name !== '');

  // Seções filtradas -- o que a grade da direita realmente desenha. Uma seção sem
  // nenhuma pergunta que bata com o filtro simplesmente não aparece aqui.
  const sections = groupIntoSections(filteredQuestions);
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
    if (allNamedSections.some((candidate) => candidate.name === nextName)) {
      toast.error('Já existe uma seção com esse nome.');
      return;
    }

    setSavingSectionName(true);
    try {
      await renameHubBriefingSection(
        section.questions.map((question) => question.id),
        nextName,
      );
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

  if (isLoading)
    return (
      <div className="py-8 flex justify-center">
        <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );

  const pendingSections = Object.keys(newQuestions).filter(
    (k) => k !== '' && !allNamedSections.find((s) => s.name === k),
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
                <div className="hub-briefing__row">
                  {editingId === q.id ? (
                    <div className="hub-briefing__edit">
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
                    <>
                      <div className="hub-briefing__cell hub-briefing__cell--question">
                        <p className="text-sm font-medium">{q.question}</p>
                      </div>
                      <div className="hub-briefing__cell hub-briefing__cell--answer">
                        {isAnswered(q) ? (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {q.answer}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">Sem resposta ainda</p>
                        )}
                        <BriefingAudioPlayer question={q} />
                      </div>
                      <div className="hub-briefing__cell hub-briefing__cell--actions">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Editar pergunta"
                          onClick={() => {
                            setEditingId(q.id);
                            setEditText(q.question);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remover pergunta"
                          onClick={() => handleDelete(q.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </>
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

  function scrollToSection(name: string) {
    document.getElementById(sectionAnchorId(name))?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }

  return (
    <div className="hub-briefing__shell">
      <aside className="hub-briefing__rail">
        <h3 className="font-semibold">Briefings</h3>

        <div className="hub-briefing__rail-toolbar">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            onClick={handleCreateBriefing}
          >
            <Plus size={14} className="mr-1.5" /> Novo briefing
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                disabled={applying || templates.length === 0}
              >
                Usar template <ChevronDown size={14} className="ml-auto" />
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
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            onClick={() => setTemplatesOpen(true)}
          >
            Templates
          </Button>
        </div>

        {briefings.length === 0 ? (
          <p className="hub-briefing__rail-empty">Nenhum briefing ainda.</p>
        ) : (
          <div
            className="hub-briefing__list"
            role="tablist"
            aria-label="Briefings"
            aria-orientation="vertical"
          >
            {briefings.map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={selectedId === b.id}
                data-active={selectedId === b.id}
                className="hub-briefing__list-item"
                onClick={() => {
                  setSelectedId(b.id);
                  resetBriefingViewState();
                }}
              >
                {b.title || <span className="italic opacity-60">Sem título</span>}
              </button>
            ))}
          </div>
        )}

        {allNamedSections.length > 0 && (
          <nav className="hub-briefing__section-index" aria-label="Seções do briefing">
            <p className="hub-briefing__section-index-label">Seções</p>
            {allNamedSections.map((s) => {
              const sectionAnswered = s.questions.filter(isAnswered).length;
              return (
                <button
                  key={s.name}
                  type="button"
                  data-testid={`secao-${s.name}`}
                  className="hub-briefing__section-link"
                  onClick={() => scrollToSection(s.name)}
                >
                  <span className="hub-briefing__section-link-name">{s.name}</span>
                  <span className="hub-briefing__section-link-count">
                    {sectionAnswered}/{s.questions.length}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </aside>

      <div className="hub-briefing__main">
        {!selectedBriefing ? (
          <p className="text-sm text-muted-foreground py-6">
            Nenhum briefing ainda. Crie um com "Novo briefing".
          </p>
        ) : (
          <>
            {/* Selected briefing header: rename / delete / import / export */}
            <div className="hub-briefing__main-head">
              <div className="hub-briefing__main-title">
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

              <div className="hub-briefing__main-actions">
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
                  <HelpCircle
                    className="h-4 w-4 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  />
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

            {/* Filtro por estado + progresso -- sempre sobre o briefing inteiro */}
            <div className="hub-briefing__filters">
              <div className="hub-briefing__chips" role="group" aria-label="Filtrar perguntas">
                <button
                  type="button"
                  data-testid="chip-todas"
                  aria-pressed={filter === 'todas'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('todas')}
                >
                  Todas <span className="hub-briefing__chip-count">{totalCount}</span>
                </button>
                <button
                  type="button"
                  data-testid="chip-sem-resposta"
                  aria-pressed={filter === 'sem-resposta'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('sem-resposta')}
                >
                  Sem resposta <span className="hub-briefing__chip-count">{unansweredCount}</span>
                </button>
                <button
                  type="button"
                  data-testid="chip-respondidas"
                  aria-pressed={filter === 'respondidas'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('respondidas')}
                >
                  Respondidas <span className="hub-briefing__chip-count">{answeredCount}</span>
                </button>
              </div>
              <div className="hub-briefing__progress-wrap">
                <div
                  className="hub-briefing__progress"
                  role="progressbar"
                  aria-label="Progresso do briefing"
                  aria-valuenow={answeredCount}
                  aria-valuemin={0}
                  aria-valuemax={totalCount}
                >
                  <div
                    className="hub-briefing__progress-bar"
                    style={{
                      width: `${totalCount > 0 ? (answeredCount / totalCount) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="hub-briefing__progress-label">
                  {answeredCount} de {totalCount} respondidas
                </p>
              </div>
            </div>

            {filteredQuestions.length === 0 && briefingQuestions.length > 0 && (
              <p className="text-sm text-muted-foreground py-4">
                Nenhuma pergunta corresponde a este filtro.
              </p>
            )}

            {/* Unsectioned questions */}
            {(unsectioned || allNamedSections.length === 0) && (
              <div className="mb-6">{renderQuestions(unsectioned?.questions ?? [], null)}</div>
            )}

            {/* Named sections (drag to reorder) */}
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
                            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <span className="truncate">{s.name}</span>
                              <span className="font-normal normal-case opacity-60">
                                ({s.questions.length})
                              </span>
                            </span>
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
                      <div id={sectionAnchorId(s.name)}>{renderQuestions(s.questions, s.name)}</div>
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
      </div>
      <BriefingTemplatesModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </div>
  );
}
