import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PostEditSuggestion, WorkflowPost } from '../../../store';
import { suggestionFieldStates, type SuggestionField } from '../editSuggestionFields';

const FIELD_ORDER: SuggestionField[] = ['texto', 'legenda'];

interface AcceptSuggestionDialogProps {
  open: boolean;
  /** Fields the client changed that the team also edited since: the reviewer picks a version. */
  conflicts: SuggestionField[];
  /** Fields only the client changed: always applied. */
  applied: SuggestionField[];
  /** The fields to send as `p_fields`, in canonical order. */
  onConfirm: (fields: SuggestionField[]) => void;
  onOpenChange: (open: boolean) => void;
}

export function AcceptSuggestionDialog({
  open,
  conflicts,
  applied,
  onConfirm,
  onOpenChange,
}: AcceptSuggestionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]" phoneDetent="fit">
        {/* Mounted only while open, so each opening starts from "keep the team version". */}
        <DialogBody
          conflicts={conflicts}
          applied={applied}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  conflicts,
  applied,
  onConfirm,
  onCancel,
}: {
  conflicts: SuggestionField[];
  applied: SuggestionField[];
  onConfirm: (fields: SuggestionField[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('postEditor');
  const [useClient, setUseClient] = useState<SuggestionField[]>([]);

  const toApply = FIELD_ORDER.filter((f) => applied.includes(f) || useClient.includes(f));
  const fieldLabel = (f: SuggestionField) =>
    f === 'texto' ? t('suggestionReview.postText') : t('shared.igCaption');
  const conflictNames = conflicts
    .map((f) =>
      t(
        f === 'texto'
          ? 'suggestionReview.dialog.fieldTexto'
          : 'suggestionReview.dialog.fieldLegenda',
      ),
    )
    .join(t('suggestionReview.dialog.and'));

  const choose = (field: SuggestionField, client: boolean) =>
    setUseClient((prev) => {
      const without = prev.filter((f) => f !== field);
      return client ? [...without, field] : without;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('suggestionReview.dialog.title')}</DialogTitle>
        <DialogDescription>
          {t('suggestionReview.dialog.body', { fields: conflictNames })}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        {applied.map((f) => (
          <div
            key={f}
            className="flex flex-col gap-1 rounded-[10px] px-3.5 py-3"
            style={{ background: 'var(--surface-1)' }}
          >
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>{fieldLabel(f)}</span>
            </div>
            <span className="pl-6 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('suggestionReview.dialog.applied')}
            </span>
          </div>
        ))}

        {conflicts.map((f) => (
          <fieldset
            key={f}
            className="m-0 flex flex-col gap-2.5 rounded-[10px] border border-amber-200 px-3.5 py-3"
          >
            <legend className="px-1 text-[14px] font-semibold">{fieldLabel(f)}</legend>
            <RadioRow
              name={`accept-${f}`}
              checked={!useClient.includes(f)}
              onSelect={() => choose(f, false)}
            >
              {t('suggestionReview.dialog.keepTeam')}
            </RadioRow>
            <RadioRow
              name={`accept-${f}`}
              checked={useClient.includes(f)}
              onSelect={() => choose(f, true)}
            >
              {t('suggestionReview.dialog.useClient')}
            </RadioRow>
          </fieldset>
        ))}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('suggestionReview.dialog.cancel')}
        </Button>
        <Button type="button" disabled={toApply.length === 0} onClick={() => onConfirm(toApply)}>
          {t('suggestionReview.dialog.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}

function RadioRow({
  name,
  checked,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-medium">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="h-[18px] w-[18px]"
      />
      {children}
    </label>
  );
}

/**
 * "Aceitar" flow shared by the desktop card and the phone sheet. No conflict: accept the
 * fields the client changed straight away. Any conflict: open the dialog first and send what
 * the reviewer picked. `onAccept` is the drawer's handler, so it always gets explicit fields,
 * plus the ones the reviewer acknowledged as conflicts to take from the client (the server
 * re-checks conflicts and refuses an unacknowledged one).
 */
export function useAcceptSuggestionFlow(
  post: Pick<WorkflowPost, 'conteudo' | 'conteudo_plain' | 'ig_caption'>,
  onAccept: (
    suggestion: PostEditSuggestion,
    fields: SuggestionField[],
    acknowledged: SuggestionField[],
  ) => void,
) {
  // `open` is separate from `suggestion` on purpose: closing keeps the last suggestion so the
  // dialog keeps rendering its fields through Radix's exit animation instead of emptying out.
  const [state, setState] = useState<{ suggestion: PostEditSuggestion; open: boolean } | null>(
    null,
  );

  const request = (suggestion: PostEditSuggestion) => {
    const states = suggestionFieldStates(post, suggestion);
    if (states.some((st) => st.conflict)) {
      setState({ suggestion, open: true });
      return;
    }
    onAccept(
      suggestion,
      states.filter((st) => st.changed).map((st) => st.field),
      [],
    );
  };

  const close = () => setState((prev) => prev && { ...prev, open: false });

  const states = state ? suggestionFieldStates(post, state.suggestion) : [];
  const conflictsNow = states.filter((st) => st.conflict).map((st) => st.field);
  const dialog = (
    <AcceptSuggestionDialog
      open={state?.open ?? false}
      conflicts={conflictsNow}
      applied={states.filter((st) => st.changed && !st.conflict).map((st) => st.field)}
      onConfirm={(fields) => {
        // The dialog stays mounted while it fades out: a second click must not accept twice.
        if (state?.open) {
          // Every conflict field in `fields` is one the reviewer picked "Usar a versão do cliente" for.
          onAccept(
            state.suggestion,
            fields,
            fields.filter((f) => conflictsNow.includes(f)),
          );
        }
        close();
      }}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    />
  );

  return { request, dialog };
}
