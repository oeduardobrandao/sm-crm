-- supabase/migrations/20260821000010_report_docs_pdf_hardening.sql
-- PR 3 do relatório de blocos: hardening do trigger de layout (invariantes
-- ESTÁVEIS espelhados de validateLayout TS; o catálogo de tipos fica só no
-- validador, decisão registrada nos reviews dos PRs 1-2), bump condicional de
-- updated_at (grava pdf_* sem invalidar o cache do PDF) e a coluna de versão
-- do renderer usada pela regra de cache do export.

ALTER TABLE report_documents ADD COLUMN pdf_renderer_version int;

-- updated_at só muda quando CONTEÚDO muda. Sem isso, gravar pdf_generated_at
-- bumparia updated_at no MESMO update e o cache (pdf_generated_at >=
-- updated_at) nasceria sempre inválido.
CREATE OR REPLACE FUNCTION set_report_documents_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.layout, NEW.title, NEW.data_snapshot, NEW.ai_content, NEW.status)
     IS DISTINCT FROM
     (OLD.layout, OLD.title, OLD.data_snapshot, OLD.ai_content, OLD.status) THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END $$;

-- Hardening: os três invariantes estáveis que a escrita direta via PostgREST
-- não pode furar. Tudo o mais (catálogo de tipos, bounds de config) continua
-- no validateLayout TS compartilhado.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- accent, quando presente, é string #rrggbb exata.
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR b ->> 'id' = ''
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
       -- text só nos tipos textuais (subset estável; espelha TEXT_BLOCK_TYPES)
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- id duplicado
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;
