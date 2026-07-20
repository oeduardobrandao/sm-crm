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
import { captureEvent } from '@/lib/analytics';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import type { EtapaFormData } from '../components/SortableEtapaList';
import { type WorkflowPreset } from './presets';
import { etapasFromPreset, etapasFromTemplate, suggestName } from './wizardLogic';
import { type WizardSource } from './createWorkflow';
import { StepTemplate } from './steps/StepTemplate';
import { StepBasics } from './steps/StepBasics';
// Steps 3–5 render `null` inline until their files land — never import a missing module.

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
  const { open, onClose, clientes, templates } = props;
  const [s, setS] = useState<WizardState>(INITIAL);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const isDirty = s.source !== null || s.clienteId !== '' || s.nome !== '';

  const requestClose = () => {
    setS(INITIAL);
    setCancelConfirm(false);
    onClose();
  };

  const selectSource = (source: WizardSource, preset?: WorkflowPreset, tpl?: WorkflowTemplate) => {
    const etapas = preset ? etapasFromPreset(preset) : tpl ? etapasFromTemplate(tpl) : [];
    const sourceNome = preset?.nome ?? tpl?.nome ?? '';
    captureEvent('workflow_wizard_source', { kind: source.kind });
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

  const continueDisabled = s.step === 2 && (!s.clienteId || !s.nome.trim());

  const goNext = () => {
    // Step 5 submits the wizard; that handler arrives with the review step.
    if (s.step < STEP_COUNT) patch({ step: (s.step + 1) as WizardState['step'] });
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
        {s.step === 3 && null}
        {s.step === 4 && null}
        {s.step === 5 && null}

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
                onClick={() => patch({ step: (s.step - 1) as WizardState['step'] })}
              >
                ← Voltar
              </Button>
              <Button onClick={goNext} disabled={continueDisabled}>
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
