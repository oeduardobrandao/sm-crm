import { Cell, FormRow, GroupedList, PickerCell } from '@mesaas/ios-kit';
import { STATUS_OPTIONS } from './fields';
import type { SeriesFormViewProps } from './series-form';

/** Series form body for the phone bottom sheet: grouped FormRows. */
export function SeriesFormPhone({
  values,
  onChange,
  slugError,
  isEdit,
  deleting,
  onDelete,
}: SeriesFormViewProps) {
  return (
    <div className="phone-kit">
      <GroupedList aria-label="Dados da série">
        <FormRow
          label="Título"
          input={{
            value: values.title,
            maxLength: 200,
            onChange: (e) => onChange({ title: e.target.value }),
          }}
        />
        <FormRow
          label="Slug"
          error={slugError}
          input={{
            value: values.slug,
            autoCapitalize: 'none',
            autoCorrect: 'off',
            onChange: (e) => onChange({ slug: e.target.value }),
          }}
        />
        <FormRow
          label="Descrição"
          textarea={{
            value: values.description,
            maxLength: 500,
            onChange: (e) => onChange({ description: e.target.value }),
          }}
        />
      </GroupedList>
      <GroupedList aria-label="Publicação">
        <FormRow
          label="Ordem"
          input={{
            type: 'number',
            inputMode: 'numeric',
            min: 0,
            max: 10000,
            value: values.displayOrder,
            onChange: (e) => onChange({ displayOrder: e.target.value }),
          }}
        />
        <PickerCell
          label="Status"
          options={STATUS_OPTIONS}
          value={values.status}
          onChange={(v) => v && onChange({ status: v })}
        />
      </GroupedList>
      {isEdit && (
        <GroupedList aria-label="Zona de risco">
          <Cell label="Excluir série" destructive disabled={deleting} onClick={onDelete} />
        </GroupedList>
      )}
    </div>
  );
}
