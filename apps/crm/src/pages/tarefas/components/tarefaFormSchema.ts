import { z } from 'zod';
import { toDateOnlyString } from '../tarefasLogic';

// Shared by TarefaFormDialog and RecorrenciaFields. Rule fields are validated
// only when `repetir` is not 'never'. `serie_nova` is a hidden form value the
// dialog sets on reset (true for create mode and for a standalone task being
// edited; false when editing an existing occurrence), because a NEW series
// must start today or later while an existing occurrence may sit in the past.
export const tarefaFormSchema = z
  .object({
    titulo: z.string().trim().min(1, 'Informe o título da tarefa'),
    descricao: z.string(),
    responsavel_id: z.string(),
    cliente_id: z.string(),
    data_limite: z.date().optional(),
    status: z.enum(['pendente', 'em_andamento', 'concluida']),
    repetir: z.enum(['never', 'daily', 'weekly', 'monthly', 'yearly']),
    /** Kept as the raw input string; parsed in superRefine so the message is ours. */
    intervalo: z.string(),
    dias_semana: z.array(z.number().int().min(0).max(6)),
    fim: z.date().optional(),
    modo: z.enum(['ao_concluir', 'calendario']),
    serie_nova: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.repetir === 'never') return;
    if (!v.data_limite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data_limite'],
        message: 'Defina um prazo: ele será a primeira ocorrência.',
      });
      return;
    }
    if (v.serie_nova && toDateOnlyString(v.data_limite) < toDateOnlyString(new Date())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data_limite'],
        message: 'Para repetir, o prazo precisa ser hoje ou depois.',
      });
    }
    if (v.repetir === 'weekly' && v.dias_semana.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dias_semana'],
        message: 'Escolha ao menos um dia da semana.',
      });
    }
    if (
      !/^\d{1,2}$/.test(v.intervalo.trim()) ||
      Number(v.intervalo) < 1 ||
      Number(v.intervalo) > 99
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intervalo'],
        message: 'Use um número de 1 a 99.',
      });
    }
    if (v.fim && toDateOnlyString(v.fim) < toDateOnlyString(v.data_limite)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fim'],
        message: 'A data final precisa ser igual ou depois do prazo.',
      });
    }
  });

export type TarefaFormValues = z.infer<typeof tarefaFormSchema>;
export type RecorrenciaFormValues = Pick<
  TarefaFormValues,
  'repetir' | 'intervalo' | 'dias_semana' | 'fim' | 'modo' | 'serie_nova'
>;

export const BLANK_TAREFA_FORM: TarefaFormValues = {
  titulo: '',
  descricao: '',
  responsavel_id: 'none',
  cliente_id: 'none',
  data_limite: undefined,
  status: 'pendente',
  repetir: 'never',
  intervalo: '1',
  dias_semana: [],
  fim: undefined,
  modo: 'ao_concluir',
  serie_nova: true,
};
