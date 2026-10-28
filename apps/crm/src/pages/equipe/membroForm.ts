import { z } from 'zod';
import { i18n } from '@mesaas/i18n';

/** Messages resolve at validation time, so they follow the current UI language. */
const msg = (key: string) => () => i18n.t(`team:membroForm.${key}`);

export const membroSchema = z
  .object({
    nome: z.string().min(1, { error: msg('nameRequired') }),
    cargo: z.string().min(1, { error: msg('roleRequired') }),
    tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
    custo: z.string(),
    diaPag: z.string().refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), {
      error: msg('dayRange'),
    }),
    crmUserId: z.string().optional(),
    // Papel of the linked CRM account: '' = leave as is, otherwise
    // 'admin' | 'agent' | 'custom:<uuid>' (same encoding as inviteRole).
    crmRole: z.string(),
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
        message: i18n.t('team:membroForm.emailInvalid'),
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
  crmRole: '',
  inviteEnabled: false,
  inviteEmail: '',
  inviteRole: 'agent',
};
