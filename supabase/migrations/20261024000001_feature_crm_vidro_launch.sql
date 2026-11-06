-- Lançamento do visual "Vidro" do CRM desktop para todos os planos
-- (flag criada desligada em 20261017000001). Planos novos nascem com ela ligada.
-- Um override {"feature_crm_vidro": false} em workspace_plan_overrides continua
-- valendo e segura aquele workspace no visual clássico; desligar a coluna de novo
-- é o kill switch. Só valor muda: nenhuma edge function precisa de redeploy.
-- Ordem: merge do popup de lançamento (VidroIntro no CRM) ANTES desta migração,
-- para quem receber o visual novo já ver o aviso com a volta ao clássico.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ALTER COLUMN feature_crm_vidro SET DEFAULT true;
UPDATE public.plans SET feature_crm_vidro = true WHERE NOT feature_crm_vidro;
