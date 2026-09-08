-- Gate de plano para a resposta de briefing por áudio (Hub):
--   feature_briefing_audio — se o workspace pode gravar/transcrever áudio no briefing
--
-- effective_plan_feature() lê as colunas de `plans` dinamicamente, então adicionar a
-- coluna já basta para o gate do hub-briefing e para o hub-bootstrap.
--
-- Política pós-downgrade: só a ESCRITA é bloqueada (presign, finalize e transcribe).
-- O GET do briefing e o player do CRM (`briefing-audio`) seguem abertos, e o
-- DELETE continua permitido — um cliente que perdeu o recurso ainda consegue ouvir
-- e remover o que já gravou.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_briefing_audio boolean NOT NULL DEFAULT false;

-- Decisão: o áudio do briefing entra nos planos Pro e Max. `lifetime` é um plano de
-- cortesia interno (existe só em produção, fora do catálogo free/start/pro/max) e é
-- top-tier, então acompanha o Max — no-op em ambientes onde a linha não existe.
UPDATE plans SET feature_briefing_audio = true WHERE id IN ('pro', 'max', 'lifetime');
