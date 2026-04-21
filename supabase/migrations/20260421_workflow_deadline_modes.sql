-- Add dia_entrega to clientes (recurring day of month 1-31)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dia_entrega integer;

-- Add modo_prazo to workflows (deadline calculation mode: padrao, data_fixa, data_entrega)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS modo_prazo text DEFAULT 'padrao'
  CHECK (modo_prazo IN ('padrao', 'data_fixa', 'data_entrega'));

-- Add data_limite (absolute deadline date) to workflow_etapas
ALTER TABLE workflow_etapas ADD COLUMN IF NOT EXISTS data_limite date;

-- Add modo_prazo to workflow_templates (for template-level mode defaults)
ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS modo_prazo text DEFAULT 'padrao'
  CHECK (modo_prazo IN ('padrao', 'data_fixa', 'data_entrega'));
