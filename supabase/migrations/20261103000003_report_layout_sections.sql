-- supabase/migrations/20261103000003_report_layout_sections.sql
-- Seções por plataforma no relatório de blocos (spec 2026-10-28-report-platform-sections,
-- §Rules). validate_report_layout() passa a aceitar o marcador `section` e a impor:
--   * tetos: até 200 blocos de CONTEÚDO (não-section) e até 12 marcadores (array até 212);
--   * forma exata do marcador (regra 4);
--   * num layout com ao menos um marcador: primeiro bloco é section (regra 1), bloco de
--     plataforma só na seção da mesma plataforma (regra 2), uma seção por plataforma (regra 3).
-- Layout sem nenhum `section` é legado e só passa pelo teto de conteúdo, como antes.
-- Espelho de sectionStructureError() em supabase/functions/_shared/report-docs/layout.ts;
-- as duas implementações rodam sobre supabase/tests/fixtures/report_section_layouts.json
-- (Deno e supabase/tests/entitlements/99_report_layout_sections.sql).
--
-- Recria a função inteira preservando o corpo da 20261003000001 (a última definição):
-- só o guard de tamanho do array muda (200 -> 212) e as checagens de seção entram no fim.

CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_block jsonb;
  v_type text;
  v_cfg jsonb;
  v_title text;
  v_block_platform text;
  -- Plataforma da seção corrente; NULL = Geral. v_in_section = já passou do 1º marcador.
  v_current text;
  v_in_section boolean := false;
  v_platforms text[] := '{}';
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     -- Guarda barata: 200 de conteúdo + 12 marcadores. Os tetos exatos vêm abaixo.
     OR jsonb_array_length(NEW.layout -> 'blocks') > 212 THEN
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
       -- text só nos tipos textuais (subset estável; espelha TEXT_BLOCK_TYPES). Cobre
       -- também o marcador section: `text` presente (inclusive JSON null) é rejeitado.
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
       -- capa é sempre largura cheia (spec 2026-08-25): pagina inteira nao faz
       -- sentido em largura parcial.
       OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
       -- imagem (spec 2026-10-02): config válido; em modelo, sem conteúdo.
       OR (b ->> 'type' = 'image'
           AND report_image_config_ok(b -> 'config', TG_TABLE_NAME = 'report_templates')
               IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- id duplicado (marcadores section inclusos, como no TS)
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- Tetos exatos: MAX_BLOCKS conta só conteúdo; marcadores têm MAX_SECTIONS.
  IF (SELECT count(*) FILTER (WHERE b ->> 'type' <> 'section') > 200
             OR count(*) FILTER (WHERE b ->> 'type' = 'section') > 12
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- Layout legado (nenhum marcador): nada mais a checar.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
     WHERE b ->> 'type' = 'section'
  ) THEN
    RETURN NEW;
  END IF;
  -- Caminhada em ordem. IFs sequenciais, não ORs num EXISTS: o Postgres não garante
  -- curto-circuito, e jsonb_object_keys() sobre um config que não é objeto levantaria
  -- outro erro (sem INVALID_LAYOUT). JSON null conta como PRESENTE (`?`/jsonb_typeof,
  -- nunca ->> IS NULL), como o `!== undefined` do TS.
  FOR v_block IN
    SELECT t.b FROM jsonb_array_elements(NEW.layout -> 'blocks') WITH ORDINALITY AS t(b, ord)
     ORDER BY t.ord
  LOOP
    v_type := v_block ->> 'type';
    IF v_type = 'section' THEN
      -- Regra 4: forma exata do marcador (`text` já foi barrado acima).
      IF v_block ->> 'size' <> 'full' THEN
        RAISE EXCEPTION 'INVALID_LAYOUT';
      END IF;
      v_current := NULL;
      IF v_block ? 'config' THEN
        v_cfg := v_block -> 'config';
        IF jsonb_typeof(v_cfg) <> 'object' THEN
          RAISE EXCEPTION 'INVALID_LAYOUT';
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_cfg) AS k
           WHERE k NOT IN ('platform', 'title', 'hideHeader')
        ) THEN
          RAISE EXCEPTION 'INVALID_LAYOUT';
        END IF;
        IF v_cfg ? 'platform' THEN
          IF jsonb_typeof(v_cfg -> 'platform') <> 'string'
             OR v_cfg ->> 'platform' NOT IN ('instagram', 'tiktok') THEN
            RAISE EXCEPTION 'INVALID_LAYOUT';
          END IF;
          v_current := v_cfg ->> 'platform';
        END IF;
        IF v_cfg ? 'title' THEN
          IF jsonb_typeof(v_cfg -> 'title') <> 'string' THEN
            RAISE EXCEPTION 'INVALID_LAYOUT';
          END IF;
          -- Trim ASCII (espaço, tab, LF, CR), espelhado em trimSectionTitle() no TS;
          -- char_length conta code points num banco UTF-8, como codePointLength().
          v_title := btrim(v_cfg ->> 'title', E' \t\n\r');
          IF char_length(v_title) < 1 OR char_length(v_title) > 80 THEN
            RAISE EXCEPTION 'INVALID_LAYOUT';
          END IF;
        END IF;
        IF v_cfg ? 'hideHeader' THEN
          IF (v_cfg -> 'hideHeader') IS DISTINCT FROM 'true'::jsonb
             OR NOT (v_cfg ? 'platform') THEN
            RAISE EXCEPTION 'INVALID_LAYOUT';
          END IF;
        END IF;
      END IF;
      -- Regra 3: no máximo uma seção por plataforma (Geral pode repetir).
      IF v_current IS NOT NULL THEN
        IF v_current = ANY (v_platforms) THEN
          RAISE EXCEPTION 'INVALID_LAYOUT';
        END IF;
        v_platforms := v_platforms || v_current;
      END IF;
      v_in_section := true;
      CONTINUE;
    END IF;
    -- Regra 1: o primeiro bloco é um marcador.
    IF NOT v_in_section THEN
      RAISE EXCEPTION 'INVALID_LAYOUT';
    END IF;
    -- Regra 2: bloco de plataforma só na seção da mesma plataforma. Espelha
    -- blockPlatform(): prefixo tiktok_ = TikTok; lista neutra = nenhuma; resto = Instagram.
    v_block_platform := CASE
      WHEN starts_with(v_type, 'tiktok_') THEN 'tiktok'
      WHEN v_type IN ('cover', 'section_header', 'divider', 'text', 'ai_summary',
                      'ai_recommendations', 'ai_goals', 'image', 'section') THEN NULL
      ELSE 'instagram'
    END;
    IF v_block_platform IS NOT NULL AND v_block_platform IS DISTINCT FROM v_current THEN
      RAISE EXCEPTION 'INVALID_LAYOUT';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
