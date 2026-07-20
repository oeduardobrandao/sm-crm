import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  CONFIRM_CLOSE_DISCARD,
  CONFIRM_CLOSE_KEEP_EDITING,
  CONFIRM_CLOSE_MSG,
  CONFIRM_CLOSE_TITLE,
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
import { toast } from 'sonner';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import type { EtapaFormData } from '../components/SortableEtapaList';
import { type WorkflowPreset } from './presets';
import {
  dataEntregaAvailability,
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
};

const STEP_COUNT = 5;

export function NewWorkflowWizard(props: {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  onCreated: () => void;
}) {
  const { open, onClose, clientes, membros, templates, onCreated } = props;
  const [s, setS] = useState<WizardState>(INITIAL);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  // Step 3's errors surface only after a blocked Continuar, then track edits live so a row
  // stops shouting the moment the user fixes it.
  const [etapasChecked, setEtapasChecked] = useState(false);
  // Same contract for step 4.
  const [prazosChecked, setPrazosChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const isDirty = s.source !== null || s.clienteId !== '' || s.nome !== '';

  const requestClose = () => {
    setS(INITIAL);
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
  // fluxo with zero etapas. Step 4 re-runs the etapa validation because its data_fixa mode hands
  // the user the same editable list step 3 had — blanking every row there must not sneak past.
  const prazosError =
    etapasIssues.globalError ??
    (modoEfetivo === 'data_entrega' && !availability.enabled
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
      });
      toast.success('Fluxo criado com sucesso!');
      if (result.warning) toast.warning(result.warning);
      captureEvent('workflow_wizard_source', {
        source: s.source?.kind === 'preset' ? s.source.presetId : (s.source?.kind ?? 'zero'),
      });
      if (result.template) captureEvent('workflow_saved_as_template');
      onCreated();
      requestClose();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao criar fluxo');
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
      if (prazosError || etapasIssues.rowErrors.size > 0) {
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
          <DialogTitle>Novo Fluxo{sourceLabel ? ` · ${sourceLabel}` : ''}</DialogTitle>
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

        {s.step === 1 && (
          <StepTemplate
            templates={templates}
            onSelectPreset={(p) =>
              selectSource({ kind: 'preset', presetId: p.id, presetNome: p.nome }, p)
            }
            onSelectTemplate={(t) =>
              selectSource(
                { kind: 'template', templateId: t.id, templateNome: t.nome },
                undefined,
                t,
              )
            }
            onSelectZero={() => selectSource({ kind: 'zero' })}
          />
        )}
        {s.step === 2 && <StepBasics state={s} patch={patch} clientes={clientes} />}
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
            rowErrors={prazosChecked ? etapasIssues.rowErrors : undefined}
            error={prazosChecked ? prazosError : null}
          />
        )}
        {s.step === 5 && (
          <StepReview state={s} patch={patch} modoPrazo={modoEfetivo} cliente={cliente} />
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
            Cancelar
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
                ← Voltar
              </Button>
              <Button onClick={goNext} disabled={continueDisabled}>
                {saving && <Spinner size="sm" />}
                {s.step === STEP_COUNT ? '✓ Criar Fluxo' : 'Continuar →'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Copy is imported, not retyped, so this can never drift from dialog.tsx's own guard. */}
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM_CLOSE_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM_CLOSE_MSG}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{CONFIRM_CLOSE_KEEP_EDITING}</AlertDialogCancel>
            <AlertDialogAction
              onClick={requestClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {CONFIRM_CLOSE_DISCARD}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
