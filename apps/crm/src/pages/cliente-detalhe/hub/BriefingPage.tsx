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
  LayoutTemplate,
  Check,
  MoreHorizontal,
  ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { BriefingTemplatesModal, type BriefingTemplateDraft } from '../BriefingTemplatesModal';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PhoneEmptyCard, PhoneRow, editRemoveActions } from '../phone/PhoneRows';
import { PhoneInlineEdit, PhoneSortableRow } from '../phone/PhoneEditing';
import { ClientePhoneNavActions, useClientePhoneHeader } from '../phone/ClientePhoneChrome';

type BriefingFilter = 'todas' | 'sem-resposta' | 'respondidas';

/**
 * Resposta vazia (ou só espaço em branco) é resposta ausente: o cliente pode
 * salvar string vazia pelo portal, e o textarea com auto-save deixa `'   '`
 * para trás quando ele apaga uma resposta digitada. Esse critério tem que
 * bater com o count `briefingAnswered` de `getPortalFill()` em
 * `store/hub.ts` -- os dois alimentam painéis diferentes da mesma contagem
 * ("O que o cliente vê" na aba Acesso vs. esta aba Briefing) e não podem
 * divergir.
 */
export function isAnswered(q: { answer: string | null }): boolean {
  return q.answer != null && q.answer.trim() !== '';
}

/**
 * Âncora estável para o "clicar na seção rola até ela" do rail -- só precisa ser um id
 * de elemento HTML válido. Nenhum teste depende deste valor (o rail usa `data-testid`).
 *
 * Indexada pela posição da seção em `allNamedSections`, não derivada do NOME dela:
 * uma versão anterior normalizava o nome (removendo acento/caixa) para montar o id, e
 * duas seções cujos nomes só diferem em acento ou espaçamento ("Café"/"Cafe",
 * "Público-alvo"/"Público alvo") colidiam no MESMO id -- `document.getElementById`
 * sempre resolvia a primeira, e `scrollToSection` nunca alcançava a segunda (achado
 * levantado três vezes de forma independente na revisão externa).
 */
function sectionAnchorId(index: number): string {
  return `hub-briefing-section-${index}`;
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
  const { t } = useTranslation('clientBriefing');
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const isPhone = !useIsDesktop(768);

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head" hidden={isPhone}>
        <div>
          <h2 className="hub-page__title">{t('page.title')}</h2>
          <p className="hub-page__sub">{t('page.subtitle')}</p>
        </div>
      </header>
      <HubRoleGate>
        {/* `key={clienteId}` força um remount inteiro ao trocar de cliente -- mesma
            lógica do Finding 3 de MarcaPage.tsx: o Outlet de ClienteDetalhePage NÃO
            desmonta ao trocar de cliente na mesma sub-aba quando o cliente de destino
            já está em cache (`isLoading` fica `false`), então sem este `key` o estado
            local de `BriefingEditor` (seleção, edição em andamento, filtro, seções
            expandidas) sobrevive à troca de cliente. */}
        <BriefingEditor
          key={clienteId}
          clienteId={clienteId}
          contaId={cliente.conta_id}
          clienteNome={cliente.nome}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] })}
        />
      </HubRoleGate>
    </div>
  );
}

function BriefingEditor({
  clienteId,
  contaId,
  clienteNome,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  clienteNome?: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation('clientBriefing');
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
  const [templateDraft, setTemplateDraft] = useState<BriefingTemplateDraft | null>(null);
  const [applying, setApplying] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  // Filtro por estado da resposta: chips com contagem no lugar do <select> (design
  // 2026-09-07). 'todas' é o padrão -- os chips e a barra de progresso sempre medem
  // o briefing inteiro, só a grade abaixo respeita o filtro.
  const [filter, setFilter] = useState<BriefingFilter>('todas');
  // Seções vêm colapsadas por padrão: cada pergunta com áudio monta um
  // BriefingAudioPlayer que dispara sozinho um fetch de URL assinada. Um
  // briefing com dezenas de respostas em áudio não pode disparar todas essas
  // chamadas só porque a página abriu -- só a seção que o usuário expandir.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Phones (below 768px): the briefing's title is the picker, so the section shell's
  // large title steps aside; the rest of the desktop toolbar lives in a "…" sheet.
  const isPhone = !useIsDesktop(768);
  useClientePhoneHeader({ hideTitle: isPhone });
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const [phonePickerOpen, setPhonePickerOpen] = useState(false);
  const [phoneTemplatesOpen, setPhoneTemplatesOpen] = useState(false);
  const [phoneRemoveOpen, setPhoneRemoveOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  // Reordenar on phones: a drag starts only from a grip, and only after a short hold, so
  // a swipe over the list keeps scrolling (MouseSensor keeps it usable with a mouse).
  const phoneSensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      toast.error(t('editor.reorderError'));
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
    setExpandedSections(new Set());
    setReordering(false);
  }

  async function handleCreateBriefing() {
    try {
      // The default title is saved to the database as the briefing's title (user data), so it
      // stays in Portuguese; the user renames it right away.
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
      toast.error(e.message ?? t('editor.createError'));
    }
  }

  async function handleRenameBriefing() {
    if (!selectedId || !renameText.trim()) return;
    try {
      await updateBriefingTitle(selectedId, renameText.trim());
      setRenaming(false);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? t('editor.renameError'));
    }
  }

  async function handleDeleteBriefing(confirmed = false) {
    if (!selectedId) return;
    if (!confirmed && !window.confirm(t('editor.confirmRemove'))) return;
    try {
      await deleteBriefing(selectedId);
      setSelectedId(null);
      refresh();
      toast.success(t('editor.removed'));
    } catch (e: any) {
      toast.error(e.message ?? t('editor.removeError'));
    }
  }

  function handleCSVImport() {
    if (!selectedId) {
      toast.error(t('editor.selectFirst'));
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
          toast.success(t('editor.imported', { count }));
          refresh();
        } else {
          toast.error(t('shared.noValidQuestions'));
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
      toast.success(t('editor.templateApplied'));
    } catch (e: any) {
      toast.error(e.message ?? t('editor.applyTemplateError'));
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
      toast.error(e.message ?? t('editor.addQuestionError'));
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
      toast.error(e.message ?? t('editor.saveQuestionError'));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHubBriefingQuestion(id);
      refresh();
      toast.success(t('editor.questionRemoved'));
    } catch (e: any) {
      toast.error(e.message ?? t('editor.removeQuestionError'));
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
      toast.error(t('editor.duplicateSection'));
      return;
    }

    // `section` vem de `namedSections` (lista FILTRADA -- ver linha 410 acima). Com um
    // chip de filtro ativo, ela só carrega as perguntas que batem com o filtro; renomear
    // com base nela deixaria as perguntas escondidas pelo filtro com o nome antigo,
    // partindo a seção em duas silenciosamente. `allNamedSections` é a mesma seção sem
    // o filtro -- é ela que decide quais perguntas realmente pertencem à seção.
    const fullSection = allNamedSections.find((candidate) => candidate.name === section.name);
    const questionIds = (fullSection ?? section).questions.map((question) => question.id);

    setSavingSectionName(true);
    try {
      await renameHubBriefingSection(questionIds, nextName);
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
      toast.success(t('editor.sectionRenamed'));
    } catch (e: any) {
      toast.error(e.message ?? t('editor.renameSectionError'));
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
                          <Save size={14} className="mr-1.5" /> {t('actions.save')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          {t('actions.cancel')}
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
                          <p className="text-xs text-muted-foreground italic">
                            {t('editor.noAnswerYet')}
                          </p>
                        )}
                        <BriefingAudioPlayer question={q} />
                      </div>
                      <div className="hub-briefing__cell hub-briefing__cell--actions">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('editor.editQuestion')}
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
                          aria-label={t('shared.removeQuestion')}
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
            placeholder={t('editor.newQuestionPlaceholder')}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => handleAddQuestion(sectionKey)}
            disabled={
              addingFor === (sectionKey ?? '') || !(newQuestions[sectionKey ?? ''] ?? '').trim()
            }
          >
            <Plus size={14} className="mr-1.5" /> {t('actions.add')}
          </Button>
        </div>
      </div>
    );
  }

  const selectedBriefing = briefings.find((b) => b.id === selectedId) ?? null;

  const canExport = !!selectedBriefing && briefingQuestions.length > 0;

  /** Abre o editor de template já preenchido com as perguntas deste briefing, na ordem em
   * que aparecem na tela (agrupadas por seção). Usa o briefing inteiro, nunca o filtro
   * ativo; respostas e áudios ficam de fora, template é só pergunta + seção. */
  function handleSaveAsTemplate() {
    if (!selectedBriefing || briefingQuestions.length === 0) return;
    setTemplateDraft({
      title: selectedBriefing.title,
      questions: allSections.flatMap((s) =>
        s.questions.map((q) => ({ question: q.question, section: q.section ?? null })),
      ),
    });
    setTemplatesOpen(true);
  }

  async function handleCopyMarkdown() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    const md = briefingToMarkdown(selectedBriefing?.title ?? '', sections);
    try {
      await navigator.clipboard.writeText(md);
      toast.success(t('editor.copiedMarkdown'));
    } catch {
      toast.error(t('editor.copyError'));
    }
  }

  async function handleCopyCSV() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    try {
      await navigator.clipboard.writeText(briefingToCSV(sections));
      toast.success(t('editor.copiedCsv'));
    } catch {
      toast.error(t('editor.copyError'));
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
    toast.success(t('editor.csvExported'));
  }

  function scrollToSection(name: string, index: number) {
    // O rail lista TODAS as seções, colapsadas ou não (contagem sempre sobre o
    // briefing inteiro -- ver allNamedSections acima). Clicar num link que
    // aponta para uma seção ainda colapsada precisa expandi-la também, ou o
    // scroll leva a um cabeçalho sem nada visível embaixo. `index` é a posição
    // da seção em `allNamedSections` -- o mesmo índice usado para montar o id
    // do cabeçalho (ver sectionAnchorId acima), não o nome.
    setExpandedSections((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    document.getElementById(sectionAnchorId(index))?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }

  if (isPhone) {
    const questionRow = (q: HubBriefingQuestionRow) =>
      editingId === q.id ? (
        <PhoneInlineEdit
          key={q.id}
          label={t('editor.editQuestion')}
          value={editText}
          onChange={setEditText}
          onSave={() => void handleSaveEdit(q.id)}
          onCancel={() => setEditingId(null)}
        />
      ) : (
        <PhoneRow
          key={q.id}
          title={q.question}
          subtitle={
            isAnswered(q) ? (
              <span className="phone-cli-brief__answer">{q.answer}</span>
            ) : (
              <span className="phone-cli-brief__answer--empty">{t('editor.noAnswerYet')}</span>
            )
          }
          meta={<BriefingAudioPlayer question={q} />}
          menuLabel={t('editor.questionActions', { question: q.question })}
          actions={editRemoveActions(
            () => {
              setEditingId(q.id);
              setEditText(q.question);
            },
            () => void handleDelete(q.id),
          )}
        />
      );

    const addRow = (sectionKey: string | null) => (
      <PhoneInlineEdit
        key="__add"
        label={t('editor.newQuestion')}
        placeholder={t('editor.newQuestionPlaceholder')}
        saveLabel={t('actions.add')}
        autoFocus={false}
        value={newQuestions[sectionKey ?? ''] ?? ''}
        onChange={(v) => setNewQuestions((prev) => ({ ...prev, [sectionKey ?? '']: v }))}
        onSave={() => void handleAddQuestion(sectionKey)}
        saving={addingFor === (sectionKey ?? '')}
      />
    );

    const menuActions: ActionSheetAction[] = selectedBriefing
      ? [
          {
            label: t('editor.rename'),
            icon: <Pencil aria-hidden="true" />,
            onSelect: () => {
              setRenaming(true);
              setRenameText(selectedBriefing.title);
            },
          },
          {
            label: t('actions.importCsv'),
            icon: <Upload aria-hidden="true" />,
            disabled: importingCsv,
            // The file picker only opens inside the tap on iOS Safari.
            immediate: true,
            onSelect: handleCSVImport,
          },
          {
            label: t('editor.saveAsTemplate'),
            icon: <LayoutTemplate aria-hidden="true" />,
            disabled: !canExport,
            onSelect: handleSaveAsTemplate,
          },
          {
            label: t('editor.copyMarkdown'),
            icon: <Copy aria-hidden="true" />,
            disabled: !canExport,
            immediate: true,
            onSelect: () => void handleCopyMarkdown(),
          },
          {
            label: t('editor.copyCsv'),
            icon: <Copy aria-hidden="true" />,
            disabled: !canExport,
            immediate: true,
            onSelect: () => void handleCopyCSV(),
          },
          {
            label: t('editor.downloadCsv'),
            icon: <Download aria-hidden="true" />,
            disabled: !canExport,
            immediate: true,
            onSelect: handleDownloadCSV,
          },
          {
            label: t('editor.reorder'),
            icon: <ArrowUpDown aria-hidden="true" />,
            disabled: briefingQuestions.length < 2,
            onSelect: () => {
              setEditingId(null);
              setReordering(true);
            },
          },
          {
            label: t('editor.removeBriefing'),
            icon: <Trash2 aria-hidden="true" />,
            destructive: true,
            onSelect: () => setPhoneRemoveOpen(true),
          },
        ]
      : [];

    const pickerActions: ActionSheetAction[] = [
      ...briefings.map((b) => ({
        label: (
          <span className="phone-cli-brief__picker">
            {b.title || t('editor.untitled')}
            {b.id === selectedId && <Check aria-label={t('editor.selected')} />}
          </span>
        ),
        onSelect: () => {
          setSelectedId(b.id);
          resetBriefingViewState();
        },
      })),
      {
        label: t('editor.newBriefing'),
        icon: <Plus aria-hidden="true" />,
        onSelect: () => void handleCreateBriefing(),
      },
      {
        label: t('editor.useTemplate'),
        icon: <LayoutTemplate aria-hidden="true" />,
        disabled: applying || templates.length === 0,
        onSelect: () => setPhoneTemplatesOpen(true),
      },
      { label: t('shared.templates'), onSelect: () => setTemplatesOpen(true) },
    ];

    const titleText = selectedBriefing
      ? selectedBriefing.title || t('editor.untitled')
      : t('editor.briefing');

    return (
      <div className="phone-cli-brief">
        {selectedBriefing && (
          <ClientePhoneNavActions>
            <PhoneIconButton
              label={t('editor.moreActions')}
              aria-haspopup="dialog"
              onClick={() => setPhoneMenuOpen(true)}
            >
              <MoreHorizontal aria-hidden="true" />
            </PhoneIconButton>
          </ClientePhoneNavActions>
        )}

        <header className="phone-kit phone-large-title phone-cli-brief__title">
          <h1 className="phone-large-title__title">
            <button
              type="button"
              className="phone-cli-brief__picker"
              aria-haspopup="dialog"
              aria-label={t('editor.switchBriefing', { title: titleText })}
              onClick={() => setPhonePickerOpen(true)}
            >
              {titleText}
              <ChevronDown aria-hidden="true" />
            </button>
          </h1>
          <p className="phone-large-title__subtitle">
            {clienteNome ? t('editor.briefingOf', { name: clienteNome }) : t('editor.briefing')}
          </p>
        </header>

        {renaming && selectedBriefing && (
          <PhoneInlineEdit
            as="div"
            label={t('editor.briefingName')}
            value={renameText}
            onChange={setRenameText}
            onSave={() => void handleRenameBriefing()}
            onCancel={() => setRenaming(false)}
          />
        )}

        {importingCsv && (
          <div
            className="csv-progress mb-3"
            role="progressbar"
            aria-label={t('shared.importingCsv')}
          />
        )}

        {!selectedBriefing ? (
          <PhoneEmptyCard title={t('editor.emptyTitle')} hint={t('editor.emptyPhoneHint')} />
        ) : reordering ? (
          <>
            <div className="phone-cli-reorder-bar">
              <span>{t('editor.reorderHint')}</span>
              <button
                type="button"
                className="phone-cli-cal__step"
                onClick={() => setReordering(false)}
              >
                {t('editor.done')}
              </button>
            </div>
            {allNamedSections.length > 1 && (
              <section className="phone-kit phone-group">
                <h2 className="phone-group__header">{t('editor.sections')}</h2>
                <DndContext
                  sensors={phoneSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleSectionDragEnd}
                >
                  <SortableContext
                    items={allNamedSections.map((sec) => SECTION_PREFIX + sec.name)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="phone-group__list">
                      {allNamedSections.map((sec) => (
                        <PhoneSortableRow
                          key={sec.name}
                          id={SECTION_PREFIX + sec.name}
                          handleLabel={t('editor.reorderSectionNamed', { name: sec.name })}
                        >
                          {sec.name}
                        </PhoneSortableRow>
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </section>
            )}
            {allSections.map((sec) => (
              <section key={sec.name || '__none'} className="phone-kit phone-group">
                <h2 className="phone-group__header">{sec.name || t('editor.noSection')}</h2>
                <DndContext
                  sensors={phoneSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleQuestionDragEnd(sec.name, e)}
                >
                  <SortableContext
                    items={sec.questions.map((q) => q.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="phone-group__list">
                      {sec.questions.map((q) => (
                        <PhoneSortableRow
                          key={q.id}
                          id={q.id}
                          handleLabel={t('editor.reorderQuestionNamed', { question: q.question })}
                        >
                          {q.question}
                        </PhoneSortableRow>
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </section>
            ))}
          </>
        ) : (
          <>
            <SegmentedControl
              aria-label={t('editor.filterQuestions')}
              className="phone-cli-brief__filters"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todas', label: t('editor.filterAllCount', { n: totalCount }) },
                {
                  value: 'sem-resposta',
                  label: t('editor.filterUnansweredCount', { n: unansweredCount }),
                },
                {
                  value: 'respondidas',
                  label: t('editor.filterAnsweredCount', { n: answeredCount }),
                },
              ]}
            />
            <div
              className="phone-cli-brief__progress"
              role="progressbar"
              aria-label={t('editor.progress')}
              aria-valuenow={answeredCount}
              aria-valuemin={0}
              aria-valuemax={totalCount}
            >
              <div
                className="phone-cli-brief__progress-bar"
                style={{ width: `${totalCount > 0 ? (answeredCount / totalCount) * 100 : 0}%` }}
              />
            </div>
            <p className="phone-cli-brief__progress-label">
              {t('editor.progressLabel', { answered: answeredCount, total: totalCount })}
            </p>

            {filteredQuestions.length === 0 && briefingQuestions.length > 0 && (
              <PhoneEmptyCard title={t('editor.noFilterMatch')} />
            )}

            {(unsectioned || allNamedSections.length === 0) && (
              <section className="phone-kit phone-group">
                <ul className="phone-group__list" aria-label={t('editor.unsectionedQuestions')}>
                  {(unsectioned?.questions ?? []).map(questionRow)}
                  {addRow(null)}
                </ul>
              </section>
            )}

            {filter === 'todas' && namedSections.length > 1 && (
              <div className="phone-cli-brief__expand">
                <button type="button" className="phone-cli-link-button" onClick={toggleAllSections}>
                  {namedSections.every((sec) => expandedSections.has(sec.name))
                    ? t('editor.collapseAll')
                    : t('editor.expandAll')}
                </button>
              </div>
            )}

            {namedSections.map((sec) => {
              const isCollapsed = filter === 'todas' && !expandedSections.has(sec.name);
              const answered = sec.questions.filter(isAnswered).length;
              return (
                <section key={sec.name} className="phone-kit phone-cli-brief__section">
                  {editingSectionName === sec.name ? (
                    <PhoneInlineEdit
                      as="div"
                      label={t('editor.sectionName')}
                      value={sectionNameText}
                      onChange={setSectionNameText}
                      saving={savingSectionName}
                      onSave={() => void handleRenameSection(sec)}
                      onCancel={() => setEditingSectionName(null)}
                    />
                  ) : (
                    <div className="phone-cli-brief__section-head">
                      <button
                        type="button"
                        className="phone-cli-brief__toggle"
                        aria-expanded={!isCollapsed}
                        disabled={filter !== 'todas'}
                        data-testid={`secao-toggle-${sec.name}`}
                        onClick={() => toggleSection(sec.name)}
                      >
                        {isCollapsed ? (
                          <ChevronRight aria-hidden="true" />
                        ) : (
                          <ChevronDown aria-hidden="true" />
                        )}
                        <span className="phone-cli-brief__toggle-name">{sec.name}</span>
                        <span className="phone-cli-brief__toggle-count">
                          {answered}/{sec.questions.length}
                        </span>
                      </button>
                      <PhoneIconButton
                        label={t('editor.renameSectionNamed', { name: sec.name })}
                        onClick={() => {
                          setEditingSectionName(sec.name);
                          setSectionNameText(sec.name);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </PhoneIconButton>
                    </div>
                  )}
                  {!isCollapsed && (
                    <div className="phone-group">
                      <ul
                        className="phone-group__list"
                        aria-label={t('editor.sectionQuestions', { name: sec.name })}
                      >
                        {sec.questions.map(questionRow)}
                        {addRow(sec.name)}
                      </ul>
                    </div>
                  )}
                </section>
              );
            })}

            {pendingSections.map((name) => (
              <section key={name} className="phone-kit phone-group">
                <h2 className="phone-group__header">{name}</h2>
                <ul className="phone-group__list">{addRow(name)}</ul>
              </section>
            ))}

            {addingSectionInput ? (
              <PhoneInlineEdit
                as="div"
                label={t('editor.sectionName')}
                placeholder={t('editor.sectionNamePlaceholder')}
                saveLabel={t('editor.createSection')}
                value={newSectionName}
                onChange={setNewSectionName}
                onSave={handleAddSection}
                onCancel={() => {
                  setAddingSectionInput(false);
                  setNewSectionName('');
                }}
              />
            ) : (
              <button
                type="button"
                className="phone-cli-button phone-cli-button--secondary phone-cli-button--block"
                onClick={() => setAddingSectionInput(true)}
              >
                <Plus aria-hidden="true" /> {t('editor.newSection')}
              </button>
            )}
          </>
        )}

        <ActionSheet
          open={phonePickerOpen}
          onOpenChange={setPhonePickerOpen}
          title={t('editor.briefings')}
          actions={pickerActions}
        />
        <ActionSheet
          open={phoneTemplatesOpen}
          onOpenChange={setPhoneTemplatesOpen}
          title={t('editor.useTemplate')}
          actions={templates.map((tpl) => ({
            label: `${tpl.title} (${(tpl.questions ?? []).length})`,
            onSelect: () => void handleApplyTemplate(tpl.id),
          }))}
        />
        <ActionSheet
          open={phoneMenuOpen}
          onOpenChange={setPhoneMenuOpen}
          title={titleText}
          hideTitle
          actions={menuActions}
        />
        <PhoneConfirmSheet
          open={phoneRemoveOpen}
          title={t('editor.removeConfirmTitle')}
          message={t('editor.removeConfirmMessage')}
          actions={[
            {
              label: t('editor.removeBriefing'),
              destructive: true,
              onSelect: () => {
                setPhoneRemoveOpen(false);
                void handleDeleteBriefing(true);
              },
            },
          ]}
          onCancel={() => setPhoneRemoveOpen(false)}
        />
        <BriefingTemplatesModal
          open={templatesOpen}
          onOpenChange={(v) => {
            setTemplatesOpen(v);
            if (!v) setTemplateDraft(null);
          }}
          initialDraft={templateDraft}
        />
      </div>
    );
  }

  return (
    <div className="hub-briefing__shell">
      <aside className="hub-briefing__rail">
        <h3 className="font-semibold">{t('editor.briefings')}</h3>

        <div className="hub-briefing__rail-toolbar">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            onClick={handleCreateBriefing}
          >
            <Plus size={14} className="mr-1.5" /> {t('editor.newBriefing')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                disabled={applying || templates.length === 0}
              >
                {t('editor.useTemplate')} <ChevronDown size={14} className="ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {templates.map((tpl) => (
                <DropdownMenuItem key={tpl.id} onClick={() => handleApplyTemplate(tpl.id)}>
                  {tpl.title} ({(tpl.questions ?? []).length})
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
            {t('shared.templates')}
          </Button>
        </div>

        {briefings.length === 0 ? (
          <p className="hub-briefing__rail-empty">{t('editor.emptyTitle')}</p>
        ) : (
          <div
            className="hub-briefing__list"
            role="tablist"
            aria-label={t('editor.briefings')}
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
                {b.title || <span className="italic opacity-60">{t('editor.untitled')}</span>}
              </button>
            ))}
          </div>
        )}

        {allNamedSections.length > 0 && (
          <nav className="hub-briefing__section-index" aria-label={t('editor.sectionIndex')}>
            <p className="hub-briefing__section-index-label">{t('editor.sections')}</p>
            {allNamedSections.map((s, sectionIndex) => {
              const sectionAnswered = s.questions.filter(isAnswered).length;
              // O rail lista TODAS as seções para a contagem cobrir o briefing inteiro
              // (ver allNamedSections acima), mas a grade só renderiza uma seção com
              // pelo menos uma pergunta batendo com o filtro ativo -- sem isso, não
              // existe âncora na página e o clique não leva a lugar nenhum.
              const hasTarget = namedSections.some((visible) => visible.name === s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  data-testid={`secao-${s.name}`}
                  className="hub-briefing__section-link"
                  disabled={!hasTarget}
                  title={hasTarget ? undefined : t('editor.sectionNoMatch')}
                  onClick={hasTarget ? () => scrollToSection(s.name, sectionIndex) : undefined}
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
          <p className="text-sm text-muted-foreground py-6">{t('editor.emptyDesktop')}</p>
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
                      <Save size={14} className="mr-1.5" /> {t('actions.save')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRenaming(false)}>
                      {t('actions.cancel')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold">
                      {selectedBriefing.title || (
                        <span className="font-normal italic text-muted-foreground">
                          {t('editor.untitled')}
                        </span>
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
                        <Pencil size={14} className="mr-1.5" /> {t('editor.rename')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleDeleteBriefing()}
                        aria-label={t('editor.removeBriefing')}
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
                  <Upload size={14} className="mr-1.5" /> {t('actions.importCsv')}
                </Button>
                <span
                  data-tooltip={t('editor.csvColumns')}
                  data-tooltip-dir="bottom"
                  style={{ display: 'flex' }}
                >
                  <HelpCircle
                    className="h-4 w-4 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  />
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveAsTemplate}
                  disabled={!canExport}
                >
                  <LayoutTemplate size={14} className="mr-1.5" /> {t('editor.saveAsTemplate')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={!canExport}>
                      <Download size={14} className="mr-1.5" /> {t('editor.export')}
                      <ChevronDown size={14} className="ml-1.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleCopyMarkdown}>
                      <Copy size={14} className="mr-2" /> {t('editor.copyMarkdown')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCopyCSV}>
                      <Copy size={14} className="mr-2" /> {t('editor.copyCsv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadCSV}>
                      <Download size={14} className="mr-2" /> {t('editor.downloadCsv')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {importingCsv && (
              <div
                className="csv-progress mb-3"
                role="progressbar"
                aria-label={t('shared.importingCsv')}
              />
            )}

            {/* Filtro por estado + progresso -- sempre sobre o briefing inteiro */}
            <div className="hub-briefing__filters">
              <div
                className="hub-briefing__chips"
                role="group"
                aria-label={t('editor.filterQuestions')}
              >
                <button
                  type="button"
                  data-testid="chip-todas"
                  aria-pressed={filter === 'todas'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('todas')}
                >
                  {t('editor.filterAll')}{' '}
                  <span className="hub-briefing__chip-count">{totalCount}</span>
                </button>
                <button
                  type="button"
                  data-testid="chip-sem-resposta"
                  aria-pressed={filter === 'sem-resposta'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('sem-resposta')}
                >
                  {t('editor.filterUnanswered')}{' '}
                  <span className="hub-briefing__chip-count">{unansweredCount}</span>
                </button>
                <button
                  type="button"
                  data-testid="chip-respondidas"
                  aria-pressed={filter === 'respondidas'}
                  className="hub-briefing__chip"
                  onClick={() => setFilter('respondidas')}
                >
                  {t('editor.filterAnswered')}{' '}
                  <span className="hub-briefing__chip-count">{answeredCount}</span>
                </button>
              </div>
              <div className="hub-briefing__progress-wrap">
                <div
                  className="hub-briefing__progress"
                  role="progressbar"
                  aria-label={t('editor.progress')}
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
                  {t('editor.progressLabel', { answered: answeredCount, total: totalCount })}
                </p>
              </div>
            </div>

            {filteredQuestions.length === 0 && briefingQuestions.length > 0 && (
              <p className="text-sm text-muted-foreground py-4">{t('editor.noFilterMatch')}</p>
            )}

            {/* Unsectioned questions */}
            {(unsectioned || allNamedSections.length === 0) && (
              <div className="mb-6">{renderQuestions(unsectioned?.questions ?? [], null)}</div>
            )}

            {/* Expandir/recolher tudo -- seções vêm colapsadas por padrão. Um filtro
                ativo (diferente de 'todas') já força toda seção aberta (ver isCollapsed
                abaixo), então o controle só faz sentido enquanto o filtro é 'todas'. */}
            {filter === 'todas' && namedSections.length > 1 && (
              <div className="flex justify-end -mt-2 mb-2">
                <button
                  type="button"
                  onClick={toggleAllSections}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {namedSections.every((s) => expandedSections.has(s.name))
                    ? t('editor.collapseAll')
                    : t('editor.expandAll')}
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
                  // Filtrar (diferente de 'todas') já é uma varredura explícita por
                  // resultado -- o usuário não deveria precisar expandir cada seção
                  // manualmente só para ver o que bateu com o filtro escolhido.
                  const isCollapsed = filter === 'todas' && !expandedSections.has(s.name);
                  const isEditingSection = editingSectionName === s.name;
                  // Mesmo índice usado pelo link do rail acima (allNamedSections.map) --
                  // `namedSections` é a versão FILTRADA de `allNamedSections`, então o
                  // índice tem que vir de lá, não da posição dentro desta lista filtrada.
                  const sectionIndex = allNamedSections.findIndex((a) => a.name === s.name);
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
                              aria-label={t('editor.sectionName')}
                              className="h-8 flex-1"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => void handleRenameSection(s)}
                              disabled={!sectionNameText.trim() || savingSectionName}
                            >
                              <Save size={14} className="mr-1.5" /> {t('actions.save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingSectionName(null)}
                              disabled={savingSectionName}
                            >
                              {t('actions.cancel')}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            {/* Filtro ativo (!= 'todas') já força a seção aberta -- ver isCollapsed
                                acima. Nesse caso o toggle não muda nada visível, então vira um
                                cabeçalho não interativo em vez de um botão que finge funcionar. */}
                            {filter === 'todas' ? (
                              <button
                                type="button"
                                id={sectionAnchorId(sectionIndex)}
                                data-testid={`secao-toggle-${s.name}`}
                                onClick={() => toggleSection(s.name)}
                                aria-expanded={!isCollapsed}
                                className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {isCollapsed ? (
                                  <ChevronRight size={14} />
                                ) : (
                                  <ChevronDown size={14} />
                                )}
                                <span className="truncate">{s.name}</span>
                                <span className="font-normal normal-case opacity-60">
                                  ({s.questions.length})
                                </span>
                              </button>
                            ) : (
                              <div
                                id={sectionAnchorId(sectionIndex)}
                                data-testid={`secao-toggle-${s.name}`}
                                className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                              >
                                <ChevronDown size={14} />
                                <span className="truncate">{s.name}</span>
                                <span className="font-normal normal-case opacity-60">
                                  ({s.questions.length})
                                </span>
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={t('editor.renameSectionNamed', { name: s.name })}
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
                  placeholder={t('editor.sectionNamePlaceholder')}
                  className="flex-1"
                  autoFocus
                />
                <Button size="sm" onClick={handleAddSection} disabled={!newSectionName.trim()}>
                  {t('editor.createSection')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAddingSectionInput(false);
                    setNewSectionName('');
                  }}
                >
                  {t('actions.cancel')}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAddingSectionInput(true)}>
                <Plus size={14} className="mr-1.5" /> {t('editor.newSection')}
              </Button>
            )}
          </>
        )}
      </div>
      <BriefingTemplatesModal
        open={templatesOpen}
        onOpenChange={(v) => {
          setTemplatesOpen(v);
          if (!v) setTemplateDraft(null);
        }}
        initialDraft={templateDraft}
      />
    </div>
  );
}
