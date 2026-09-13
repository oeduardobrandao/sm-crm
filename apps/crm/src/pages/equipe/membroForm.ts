import { z } from 'zod';

export const membroSchema = z
  .object({
    nome: z.string().min(1, 'Nome obrigatório'),
    cargo: z.string().min(1, 'Cargo obrigatório'),
    tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
    custo: z.string(),
    diaPag: z
      .string()
      .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
    crmUserId: z.string().optional(),
    inviteEnabled: z.boolean(),
    inviteEmail: z.string(),
    // 'admin' | 'agent' | 'custom:<uuid>' — the custom-role encoding is
    // decoded (and its uuid shape validated) by the server, mirroring
    // manage-workspace-user's own `role`/`roleId` split (Task 5).
    inviteRole: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.inviteEnabled && !/^\S+@\S+\.\S+$/.test(v.inviteEmail.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inviteEmail'],
        message: 'Email inválido',
      });
    }
  });

export type MembroFormValues = z.infer<typeof membroSchema>;

export const MEMBRO_FORM_DEFAULTS: MembroFormValues = {
  nome: '',
  cargo: '',
  tipo: 'clt',
  custo: '',
  diaPag: '',
  crmUserId: '',
  inviteEnabled: false,
  inviteEmail: '',
  inviteRole: 'agent',
};
