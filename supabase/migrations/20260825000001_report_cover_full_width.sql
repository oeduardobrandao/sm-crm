-- supabase/migrations/20260825000001_report_cover_full_width.sql
-- Bloco 'cover' sempre size 'full' (spec 2026-08-25): pagina inteira so faz
-- sentido em largura cheia. Recria a funcao inteira (CREATE OR REPLACE)
-- preservando todo o corpo da 20260824000002, so adicionando essa condicao ao
-- EXISTS que ja valida a forma de cada bloco. Forward-only: sem downgrade,
-- mesmo padrao do resto do projeto.
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
  -- theme/fonts, quando presentes, sao strings dos enums fechados.
  IF NEW.layout ? 'theme' AND (
       jsonb_typeof(NEW.layout -> 'theme') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'theme' NOT IN ('clean', 'editorial', 'bold', 'hub')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'fonts' AND (
       jsonb_typeof(NEW.layout -> 'fonts') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'fonts' NOT IN ('system', 'fraunces', 'grotesk', 'playfair')
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
       -- capa é sempre largura cheia (spec 2026-08-25): pagina inteira nao faz
       -- sentido em largura parcial.
       OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
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
