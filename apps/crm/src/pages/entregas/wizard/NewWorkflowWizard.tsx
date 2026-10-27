import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  useConfirmCloseCopy,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { captureEvent } from '@/lib/analytics';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { PlatformId } from '@mesaas/platforms';
import { removeWorkflow } from '../../../store';
import type { Cliente, Membro, Workflow, WorkflowTemplate } from '../../../store';
import type { LinhaItem } from '@/store/linhaEditorial';
import type { EtapaFormData } from '../components/SortableEtapaList';
import { type WorkflowPreset } from './presets';
import {
  dataEntregaAvailability,
  postsLabel,
  etapasFromPreset,
  etapasFromTemplate,
  suggestName,
  validateEtapas,
  validatePrazos,
} from './wizardLogic';
import { createWorkflowFromWizard, type WizardSource } from './createWorkflow';
import { StepTemplate } from './steps/StepTemplate';
import { StepBasics } from './steps/StepBasics';
import { StepEtapas } from './steps/StepEtapas';
import { StepPrazos } from './steps/StepPrazos';
import { StepReview } from './steps/StepReview';

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  source: WizardSource | null;
  /** The Select speaks strings; parsed to a number only at creation time. */
  clienteId: string;
  nome: string;
  /** Set once the user types a name, so a source switch never overwrites their wording. */
  nomeEdited: boolean;
  recorrente: boolean;
  etapas: EtapaFormData[];
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  /** Set once the user picks a mode, so a source switch never overwrites their choice. */
  modoEdited: boolean;
  mesEntrega: string;
  saveAsTemplate: boolean;
  templateName: string;
  plataformas: PlatformId[];
}

const INITIAL: WizardState = {
  step: 1,
  source: null,
  clienteId: '',
  nome: '',
  nomeEdited: false,
  recorrente: false,
  etapas: [],
  modoPrazo: 'padrao',
  modoEdited: false,
  mesEntrega: '',
  saveAsTemplate: false,
  templateName: '',
  plataformas: ['instagram'],
};

const STEP_COUNT = 5;

/**
 * Opens the wizard to turn rows of a linha editorial into a fluxo (spec §7.1). The client is
 * locked, the name is preset, and `afterCreate` creates the posts once the fluxo exists.
 */
export interface WizardSeed {
  clienteId: number;
  nome: string;
  /** "linha editorial de novembro". */
  origemLabel: string;
  itens: LinhaItem[];
  /** Runs after the fluxo is created and before `onCreated`. A throw removes the fluxo. */
  afterCreate: (workflow: Workflow) => Promise<void>;
}

function initialState(seed: WizardSeed | undefined): WizardState {
  if (!seed) return INITIAL;
  // `nomeEdited` keeps the seeded name when a template is picked on step 1.
  return { ...INITIAL, clienteId: String(seed.clienteId), nome: seed.nome, nomeEdited: true };
}

export function NewWorkflowWizard(props: {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  onCreated: () => void;
  /** Quick-add from a board row: preselects this template and opens on step 2. */
  initialTemplateId?: number;
  /** Creating a fluxo from linha editorial rows. */
  seed?: WizardSeed;
}) {
  const { t } = useTranslation('workflows');
  const confirmCopy = useConfirmCloseCopy();
  const { open, onClose, clientes, membros, templates, onCreated, initialTemplateId, seed } = props;
  const [s, setS] = useState<WizardState>(() => initialState(seed));
  const multiplatform = useWorkspaceLimits().features?.feature_multiplatform === true;
  const [cancelConfirm, setCancelConfirm] = useState(false);
  // Step 3's errors surface only after a blocked Continuar, then track edits live so a row
  // stops shouting the moment the user fixes it.
  const [etapasChecked, setEtapasChecked] = useState(false);
  // Same contract for step 4.
  const [prazosChecked, setPrazosChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  // Measured against the opening state, so a seeded wizard nobody touched closes quietly.
  const baseline = initialState(seed);
  const isDirty =
    s.source !== null || s.clienteId !== baseline.clienteId || s.nome !== baseline.nome;

  // Quick-add path: apply the board row's template once, as if the user had
  // picked it on step 1. Ref-guarded because selectSource is a fresh closure
  // every render.
  const appliedInitialTemplate = useRef(false);
  useEffect(() => {
    if (appliedInitialTemplate.current || initialTemplateId == null) return;
    const tpl = templates.find((t) => t.id === initialTemplateId);
    if (!tpl) return;
    appliedInitialTemplate.current = true;
    selectSource({ kind: 'template', templateId: tpl.id!, templateNome: tpl.nome }, undefined, tpl);
  });

  const requestClose = () => {
    setS(initialState(seed));
    setCancelConfirm(false);
    setEtapasChecked(false);
    setPrazosChecked(false);
    onClose();
  };

  const selectSource = (source: WizardSource, preset?: WorkflowPreset, tpl?: WorkflowTemplate) => {
    const etapas = preset ? etapasFromPreset(preset) : tpl ? etapasFromTemplate(tpl) : [];
    const sourceNome = preset?.nome ?? tpl?.nome ?? '';
    // `workflow_wizard_source` fires once per SUCCESSFUL creation (see handleCreate), not on each
    // step-1 selection — funnel-abandon analysis is a non-goal and per-selection firing would
    // count a single fluxo several times.
    // A new source brings brand-new etapas, so the previous attempt's errors are meaningless.
    setEtapasChecked(false);
    setPrazosChecked(false);
    patch({
      source,
      etapas,
      modoPrazo: preset?.modo_prazo ?? tpl?.modo_prazo ?? 'padrao',
      modoEdited: false,
      // Recorrência is a property of the preset; templates and "do zero" leave the user's choice.
      recorrente: preset ? preset.recorrente : s.recorrente,
      nome: s.nomeEdited ? s.nome : sourceNome ? suggestName(sourceNome) : '',
      // Sem feature_multiplatform o quadro nasce {instagram} mesmo de um template
      // salvo com outras plataformas (o banco recusaria o INSERT).
      plataformas: multiplatform ? (tpl?.plataformas ?? s.plataformas) : ['instagram'],
      step: 2,
    });
  };

  const sourceLabel =
    s.source && s.source.kind !== 'zero'
      ? 'presetNome' in s.source
        ? s.source.presetNome
        : s.source.templateNome
      : '';

  const continueDisabled = saving || (s.step === 2 && (!s.clienteId || !s.nome.trim()));

  const cliente = clientes.find((c) => c.id === Number(s.clienteId));
  const availability = dataEntregaAvailability(s.etapas, cliente);

  // The source's preferred mode stays in `modoPrazo` untouched; the fallback is DERIVED so that
  // switching to a client who does have a dia de entrega silently restores the preference,
  // while an explicit choice (`modoEdited`) is never overridden behind the user's back.
  const modoEfetivo: WizardState['modoPrazo'] =
    !s.modoEdited && s.modoPrazo === 'data_entrega' && !availability.enabled
      ? 'padrao'
      : s.modoPrazo;

  const etapasIssues = validateEtapas(s.etapas, membros);

  // Defense in depth for `createWorkflowFromWizard`, which has none of its own: it silently writes
  // null deadlines when asked for data_entrega without a dia de entrega, and happily creates a
  // fluxo with zero etapas. Step 4 re-runs the FULL etapa validation because its data_fixa mode
  // hands the user the same editable list step 3 had — and every branch that blocks `Continuar`
  // must produce a message, or the button just dies silently.
  const prazosError =
    etapasIssues.globalError ??
    (etapasIssues.rowErrors.size > 0
      ? t('wizard.reviewAssignees')
      : modoEfetivo === 'data_entrega' && !availability.enabled
        ? availability.reason
        : validatePrazos(s.etapas, modoEfetivo));

  // Recomputed every render once the user has tried to leave step 3, so fixes clear their errors.
  const etapasValidation = etapasChecked ? etapasIssues : null;

  const handleCreate = async () => {
    setSaving(true);
    try {
      const result = await createWorkflowFromWizard({
        clienteId: Number(s.clienteId),
        titulo: s.nome,
        recorrente: s.recorrente,
        modoPrazo: modoEfetivo,
        mesEntrega: s.mesEntrega,
        etapas: s.etapas,
        source: s.source ?? { kind: 'zero' },
        saveAsTemplate: s.saveAsTemplate,
        templateName: s.templateName,
        cliente,
        membros,
        plataformas: multiplatform ? s.plataformas : ['instagram'],
      });
      if (seed) {
        try {
          await seed.afterCreate(result.workflow);
        } catch (err) {
          // The posts were not created, so neither is the fluxo. A saved template is kept,
          // as when createWorkflowFromWizard fails after saving it.
          try {
            await removeWorkflow(result.workflow.id!);
          } catch {
            /* best effort: the toast names the conversion error */
          }
          throw err;
        }
      }
      toast.success(
        seed
          ? t('wizard.createdWithPosts', { posts: postsLabel(seed.itens.length) })
          : t('wizard.created'),
      );
      if (result.warning) toast.warning(result.warning);
      captureEvent('workflow_wizard_source', {
        source: s.source?.kind === 'preset' ? s.source.presetId : (s.source?.kind ?? 'zero'),
      });
      if (result.template) captureEvent('workflow_saved_as_template');
      onCreated();
      requestClose();
    } catch (err: unknown) {
      toast.error((err as Error).message || t('wizard.createError'));
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    if (s.step === 3) {
      if (etapasIssues.globalError || etapasIssues.rowErrors.size > 0) {
        setEtapasChecked(true);
        return;
      }
      setEtapasChecked(false);
    }
    if (s.step === 4) {
      // `prazosError` now covers every step-4 blocker, row errors included.
      if (prazosError) {
        setPrazosChecked(true);
        return;
      }
      setPrazosChecked(false);
    }
    if (s.step === STEP_COUNT) {
      void handleCreate();
      return;
    }
    patch({ step: (s.step + 1) as WizardState['step'] });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isDirty) requestClose();
      }}
    >
      <DialogContent
        confirmClose={isDirty}
        onConfirmClose={requestClose}
        // Each step carries its own explanatory copy, so there is no single dialog description.
        aria-describedby={undefined}
        style={{ maxWidth: 760, width: 'calc(100vw - 2rem)' }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('wizard.title')}
            {sourceLabel ? ` · ${sourceLabel}` : ''}
          </DialogTitle>
          <div style={{ display: 'flex', gap: 4, marginTop: '0.5rem' }} aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span
                key={i}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 2,
                  background: i < s.step ? '#eab308' : 'var(--border-color)',
                }}
              />
            ))}
          </div>
        </DialogHeader>

        {seed && s.step < STEP_COUNT && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: '0.8rem',
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.35)',
              borderRadius: 10,
              padding: '0.55rem 0.8rem',
            }}
          >
            {t('wizard.seedNotice', {
              count: seed.itens.length,
              posts: postsLabel(seed.itens.length),
              origem: seed.origemLabel,
            })}
          </p>
        )}

        {s.step === 1 && (
          <StepTemplate
            templates={templates}
            onSelectPreset={(p) =>
              selectSource({ kind: 'preset', presetId: p.id, presetNome: p.nome }, p)
            }
            onSelectTemplate={(tpl) =>
              selectSource(
                { kind: 'template', templateId: tpl.id, templateNome: tpl.nome },
                undefined,
                tpl,
              )
            }
            onSelectZero={() => selectSource({ kind: 'zero' })}
          />
        )}
        {s.step === 2 && (
          <StepBasics state={s} patch={patch} clientes={clientes} clienteLocked={!!seed} />
        )}
        {s.step === 3 && (
          <StepEtapas
            state={s}
            patch={patch}
            membros={membros}
            rowErrors={etapasValidation?.rowErrors}
            globalError={etapasValidation?.globalError ?? null}
          />
        )}
        {s.step === 4 && (
          <StepPrazos
            state={s}
            patch={patch}
            modoPrazo={modoEfetivo}
            cliente={cliente}
            membros={membros}
            availability={availability}
            rowErrors={prazosChecked ? etapasIssues.rowErrors : undefined}
            error={prazosChecked ? prazosError : null}
          />
        )}
        {s.step === 5 && (
          <StepReview
            state={s}
            patch={patch}
            modoPrazo={modoEfetivo}
            cliente={cliente}
            seed={seed}
          />
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginTop: '1rem',
          }}
        >
          <Button
            variant="outline"
            onClick={() => {
              if (isDirty) setCancelConfirm(true);
              else requestClose();
            }}
          >
            {t('actions.cancel')}
          </Button>
          {s.step > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  // Going back is not an attempt to advance — arrive at a step with a clean slate.
                  setEtapasChecked(false);
                  setPrazosChecked(false);
                  patch({ step: (s.step - 1) as WizardState['step'] });
                }}
              >
                {t('wizard.back')}
              </Button>
              <Button onClick={goNext} disabled={continueDisabled}>
                {saving && <Spinner size="sm" />}
                {s.step !== STEP_COUNT
                  ? t('wizard.continue')
                  : seed
                    ? t('wizard.createWithPosts', { posts: postsLabel(seed.itens.length) })
                    : t('wizard.create')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Copy is imported, not retyped, so this can never drift from dialog.tsx's own guard. */}
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirmCopy.keepEditing}</AlertDialogCancel>
            <AlertDialogAction
              onClick={requestClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmCopy.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
