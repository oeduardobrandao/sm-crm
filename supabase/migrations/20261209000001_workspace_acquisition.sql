-- Origem de aquisição do workspace
-- (spec docs/superpowers/specs/2026-11-26-workspace-acquisition-source-design.md §3).
--
-- (1) workspace_acquisition: uma linha por workspace com os touches saneados
--     (first/last), o canal do classificador e a campanha do touch lido.
--     captured = false quando o cadastro não trouxe acq (canal 'unknown').
-- (2) acquisition_pending: ponte entre os dois triggers de cadastro (user_id ->
--     acq saneado). Linhas órfãs com mais de um dia saem no próximo cadastro.
-- (3) acquisition_sanitize_touch / acquisition_channel: saneamento e regras de
--     canal. As regras vivem só aqui: mudar = CREATE OR REPLACE numa migration
--     nova + UPDATE das linhas existentes.
-- (4) workspace_acquisition_reclassify: recalcula canal e campanha de um
--     workspace (o platform-admin chama ao definir ou remover um afiliado).
-- (5) Triggers em auth.users:
--     on_auth_user_created_aaa_acquisition_stash (BEFORE INSERT OR UPDATE OF
--     raw_user_meta_data): tira acq do metadata para ele não ficar legível pelo
--     dono nem viajar no access token, e no INSERT guarda o acq saneado em
--     acquisition_pending. O GoTrue faz um UPDATE com o metadata em memória
--     (ainda com acq) logo depois do INSERT, por isso o ramo de UPDATE é
--     obrigatório; ele só remove, nunca grava pending.
--     on_auth_user_created_zzz_acquisition (AFTER INSERT): roda depois de
--     on_auth_user_created_workspace e on_auth_user_created_zz_affiliate_referral
--     (ordem alfabética), então o workspace e a indicação já existem.
--     O GoTrue insere como supabase_auth_admin, que não tem direito nas tabelas
--     de public: as duas funções são SECURITY DEFINER, como a de afiliados.
--     on_auth_identity_acquisition_strip (BEFORE INSERT OR UPDATE OF
--     identity_data em auth.identities): o GoTrue também copia o metadata cru
--     em identity_data; o trigger tira acq de lá.
--     Nenhuma falha aqui derruba o cadastro.
-- (6) ever_paid_workspace_ids: quais ids de uma lista já pagaram alguma vez
--     (regra do classOf do metrics-logic, ever_subscribed_at ou
--     reverse_trial_first_paid_at), para o Admin não paginar snapshots diários.
--
-- Tabelas e RPCs só para o service_role. REVOKE nomeado de anon/authenticated:
-- REVOKE FROM PUBLIC não os remove.
--
-- Rollback: DROP TRIGGER dos três triggers devolve o cadastro ao estado
-- anterior; tabelas e funções podem ficar.

-- (1) workspace_acquisition
CREATE TABLE IF NOT EXISTS public.workspace_acquisition (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  first_touch  jsonb,
  last_touch   jsonb,
  channel      text NOT NULL,
  campaign     text,
  captured     boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_acquisition_channel_idx
  ON public.workspace_acquisition (channel);

ALTER TABLE public.workspace_acquisition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_acquisition FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.workspace_acquisition TO service_role;

-- (2) acquisition_pending
CREATE TABLE IF NOT EXISTS public.acquisition_pending (
  user_id    uuid PRIMARY KEY,
  acq        jsonb,
  captured   boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acquisition_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.acquisition_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.acquisition_pending TO service_role;

-- (3a) Saneamento de um touch. O metadata vem do navegador (controlado pelo
-- usuário): só as 10 chaves do Touch, texto só quando é string JSON (aparado,
-- vazio vira null, cortado em 200), utm_source/utm_medium em minúsculas,
-- landing_path só o caminho (sem query nem hash, e sem o token das rotas com
-- token), at só timestamp ISO, click só da lista, referrer_host só com cara de
-- host e até 200 (acima vira null: host cortado é lixo), ref só booleano.
-- Devolve null quando t não é objeto. STABLE, não IMMUTABLE: o cast de at para
-- timestamptz depende do TimeZone da sessão.
CREATE OR REPLACE FUNCTION public.acquisition_sanitize_touch(t jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_out   jsonb := '{}'::jsonb;
  v_key   text;
  v_val   text;
  v_click text;
  v_host  text;
  v_path  text;
  v_tok   text;
  v_at    text;
BEGIN
  IF t IS NULL OR jsonb_typeof(t) <> 'object' THEN
    RETURN NULL;
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'
  ] LOOP
    v_val := NULL;
    IF jsonb_typeof(t -> v_key) = 'string' THEN
      v_val := left(NULLIF(btrim(t ->> v_key), ''), 200);
      IF v_key IN ('utm_source', 'utm_medium') THEN
        v_val := lower(v_val);
      END IF;
    END IF;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  END LOOP;

  -- landing_path: só o caminho. Corta na primeira ? ou # (query e hash podem
  -- trazer click ids) e exige / inicial; senão null. Rotas do CRM com token no
  -- caminho (painel de afiliado, convite, descadastro, cancelar avisos) ficam só
  -- com o prefixo: o token é uma credencial. Mesma lista de TOKEN_ROUTE em
  -- apps/crm/src/lib/acquisition.ts (manter as duas juntas); sem diferenciar
  -- maiúsculas e com barras repetidas colapsadas, como o React Router casa.
  IF jsonb_typeof(t -> 'landing_path') = 'string' THEN
    v_path := split_part(split_part(btrim(t ->> 'landing_path'), '?', 1), '#', 1);
    IF left(v_path, 1) = '/' THEN
      v_tok := substring(regexp_replace(v_path, '/{2,}', '/', 'g')
                         FROM '(?i)^/(afiliados/painel|conectar|descadastrar|cancelar-avisos)/');
      IF v_tok IS NOT NULL THEN
        v_path := '/' || lower(v_tok);
      END IF;
      v_path := left(v_path, 200);
    ELSE
      v_path := NULL;
    END IF;
  END IF;

  -- at: só data/hora ISO 8601 válida (o regex barra 'now', 'infinity' e afins,
  -- e o cast barra datas impossíveis); guarda o texto original.
  IF jsonb_typeof(t -> 'at') = 'string'
     AND t ->> 'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$' THEN
    BEGIN
      PERFORM (t ->> 'at')::timestamptz;
      v_at := t ->> 'at';
    EXCEPTION WHEN OTHERS THEN
      v_at := NULL;
    END;
  END IF;

  IF jsonb_typeof(t -> 'click') = 'string'
     AND t ->> 'click' IN ('gclid', 'gbraid', 'wbraid', 'fbclid', 'oppref', 'msclkid') THEN
    v_click := t ->> 'click';
  END IF;

  IF jsonb_typeof(t -> 'referrer_host') = 'string'
     AND t ->> 'referrer_host' ~ '^[a-z0-9.-]{1,253}$'
     AND length(t ->> 'referrer_host') <= 200 THEN
    v_host := t ->> 'referrer_host';
  END IF;

  RETURN v_out || jsonb_build_object(
    'landing_path', v_path,
    'at', v_at,
    'click', v_click,
    'referrer_host', v_host,
    'ref', COALESCE(t -> 'ref' = 'true'::jsonb, false)
  );
END;
$$;

-- (3b) Classificador. Primeira regra que casa vence (tabela da spec §3, com a
-- regra 8b). has_affiliate = existe linha em affiliate_referrals do workspace.
-- Lê o jsonb com checagem de tipo, então nunca levanta erro com entrada crua.
CREATE OR REPLACE FUNCTION public.acquisition_channel(t jsonb, has_affiliate boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_src  text;
  v_med  text;
  v_clk  text;
  v_host text;
  v_ref  boolean;
BEGIN
  IF t IS NULL OR jsonb_typeof(t) <> 'object' THEN
    RETURN 'direct';
  END IF;

  IF jsonb_typeof(t -> 'utm_source') = 'string' THEN
    v_src := NULLIF(lower(btrim(t ->> 'utm_source')), '');
  END IF;
  IF jsonb_typeof(t -> 'utm_medium') = 'string' THEN
    v_med := NULLIF(lower(btrim(t ->> 'utm_medium')), '');
  END IF;
  IF jsonb_typeof(t -> 'click') = 'string' THEN
    v_clk := NULLIF(t ->> 'click', '');
  END IF;
  IF jsonb_typeof(t -> 'referrer_host') = 'string' THEN
    v_host := NULLIF(lower(btrim(t ->> 'referrer_host')), '');
  END IF;
  v_ref := COALESCE(t -> 'ref' = 'true'::jsonb, false);

  -- 1. afiliado: indicação registrada e o link de afiliado foi o touch lido.
  IF COALESCE(has_affiliate, false) AND v_ref THEN
    RETURN 'affiliate';
  END IF;

  -- 2. anúncio do ChatGPT.
  IF v_clk = 'oppref' THEN
    RETURN 'chatgpt_ads';
  END IF;

  -- 3. Google Ads.
  IF v_clk IN ('gclid', 'gbraid', 'wbraid')
     OR (v_src IN ('google', 'adwords') AND v_med IN ('cpc', 'ppc', 'paid')) THEN
    RETURN 'google_ads';
  END IF;

  -- 4. Meta Ads (pelas UTMs; fbclid sozinho também vem de clique orgânico).
  IF v_src IN ('meta', 'facebook', 'fb', 'instagram', 'ig')
     AND v_med IN ('paid', 'cpc', 'ppc', 'paid_social') THEN
    RETURN 'meta_ads';
  END IF;

  -- 5. outros anúncios.
  IF v_clk = 'msclkid' OR v_med IN ('cpc', 'ppc', 'paid') THEN
    RETURN 'other_ads';
  END IF;

  -- 6. e-mail.
  IF v_med = 'email'
     OR v_host IN ('mail.google.com', 'com.google.android.gm', 'outlook.live.com',
                   'outlook.office.com', 'outlook.office365.com') THEN
    RETURN 'email';
  END IF;

  -- 7. Instagram orgânico.
  IF v_src IN ('ig', 'instagram')
     OR v_host ~ '(^|\.)instagram\.com$'
     OR v_host = 'com.instagram.android' THEN
    RETURN 'instagram';
  END IF;

  -- 8. outras redes sociais.
  IF v_med = 'social'
     OR v_host ~ '(^|\.)(facebook\.com|fb\.com|fb\.me|tiktok\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|x\.com|twitter\.com|t\.co|threads\.net|threads\.com|whatsapp\.com|wa\.me)$'
     OR v_host IN ('l.wl.co', 'com.facebook.katana', 'com.facebook.lite', 'com.zhiliaoapp.musically',
                   'com.ss.android.ugc.trill', 'com.linkedin.android', 'com.google.android.youtube',
                   'com.twitter.android', 'com.whatsapp') THEN
    RETURN 'other_social';
  END IF;

  -- 8b. fbclid sem nada acima: o navegador interno da Meta tira o referrer,
  -- então não dá para separar Facebook de Instagram.
  IF v_clk = 'fbclid' THEN
    RETURN 'other_social';
  END IF;

  -- 9. assistentes de IA.
  IF v_src = 'chatgpt.com'
     OR v_host ~ '(^|\.)(chatgpt\.com|claude\.ai|perplexity\.ai)$'
     OR v_host IN ('chat.openai.com', 'gemini.google.com', 'copilot.microsoft.com') THEN
    RETURN 'ai';
  END IF;

  -- 10. buscadores (qualquer google.*, ancorado para outros *.google.com não
  -- contarem como busca).
  IF v_host ~ '^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$'
     OR v_host = 'com.google.android.googlequicksearchbox'
     OR v_host ~ '(^|\.)(bing\.com|duckduckgo\.com|ecosia\.org|baidu\.com|search\.yahoo\.com)$'
     OR v_host ~ '(^|\.)yandex\.(ru|com|com\.tr|by|kz|ua)$' THEN
    RETURN 'search';
  END IF;

  -- 11. qualquer outro touch não direto.
  IF v_host IS NOT NULL OR v_src IS NOT NULL OR v_med IS NOT NULL
     OR v_clk IS NOT NULL OR v_ref THEN
    RETURN 'other_sites';
  END IF;

  -- 12.
  RETURN 'direct';
END;
$$;

REVOKE ALL ON FUNCTION public.acquisition_sanitize_touch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquisition_channel(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquisition_sanitize_touch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquisition_channel(jsonb, boolean) TO service_role;

-- (4) Recalcula canal e campanha de um workspace a partir do touch guardado
-- (last quando é objeto, senão first) e da existência atual da indicação.
-- Linha com captured = false fica como está. Devolve o canal, null sem linha.
CREATE OR REPLACE FUNCTION public.workspace_acquisition_reclassify(p_workspace uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
BEGIN
  UPDATE public.workspace_acquisition a
     SET channel = public.acquisition_channel(
           CASE WHEN jsonb_typeof(a.last_touch) = 'object' THEN a.last_touch ELSE a.first_touch END,
           EXISTS (SELECT 1 FROM public.affiliate_referrals r WHERE r.workspace_id = a.workspace_id)),
         campaign = (CASE WHEN jsonb_typeof(a.last_touch) = 'object' THEN a.last_touch ELSE a.first_touch END)
                    ->> 'utm_campaign'
   WHERE a.workspace_id = p_workspace
     AND a.captured
  RETURNING a.channel INTO v_channel;

  IF NOT FOUND THEN
    SELECT a.channel INTO v_channel
      FROM public.workspace_acquisition a
     WHERE a.workspace_id = p_workspace;
  END IF;

  RETURN v_channel;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_acquisition_reclassify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_acquisition_reclassify(uuid) TO service_role;

-- (5a) BEFORE: remove acq do metadata e, no INSERT de quem não é convidado,
-- guarda o acq saneado. captured exige first objeto. O pending sempre é gravado
-- para um cadastro sem conta_id (captured = false sem acq), então o AFTER
-- distingue "sem captura" de "falhou".
CREATE OR REPLACE FUNCTION public.stash_signup_acquisition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acq      jsonb;
  v_captured boolean;
BEGIN
  BEGIN
    IF jsonb_typeof(NEW.raw_user_meta_data) = 'object' THEN
      v_acq := NEW.raw_user_meta_data -> 'acq';
      IF NEW.raw_user_meta_data ? 'acq' THEN
        NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'acq';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'acquisition strip failed for user %: %', NEW.id, SQLERRM;
  END;

  IF TG_OP = 'INSERT' THEN
    BEGIN
      IF NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '') IS NULL THEN
        v_captured := COALESCE(jsonb_typeof(v_acq -> 'first') = 'object', false);
        INSERT INTO public.acquisition_pending (user_id, acq, captured)
        VALUES (
          NEW.id,
          CASE WHEN v_captured THEN jsonb_build_object(
            'first', public.acquisition_sanitize_touch(v_acq -> 'first'),
            'last', public.acquisition_sanitize_touch(v_acq -> 'last'))
          END,
          v_captured)
        ON CONFLICT (user_id) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'acquisition stash skipped for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stash_signup_acquisition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_aaa_acquisition_stash ON auth.users;
CREATE TRIGGER on_auth_user_created_aaa_acquisition_stash
  BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.stash_signup_acquisition();

-- (5b) AFTER: lê e apaga o pending (o DELETE fica mesmo se o INSERT da linha
-- falhar, para o touch não sobrar), grava a linha do workspace do dono e, num
-- bloco próprio depois dela, limpa pendings com mais de um dia. Sem captura,
-- 'unknown' sem chamar o classificador (para "sem dados" nunca virar "direto").
CREATE OR REPLACE FUNCTION public.record_workspace_acquisition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws       uuid;
  v_acq      jsonb;
  v_captured boolean;
  v_first    jsonb;
  v_last     jsonb;
  v_touch    jsonb;
  v_channel  text;
  v_campaign text;
BEGIN
  BEGIN
    IF NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '') IS NOT NULL THEN
      RETURN NEW;
    END IF;

    DELETE FROM public.acquisition_pending
     WHERE user_id = NEW.id
    RETURNING acq, captured INTO v_acq, v_captured;

    SELECT p.conta_id INTO v_ws
      FROM public.profiles p
     WHERE p.id = NEW.id AND p.role = 'owner'::user_role;
    IF v_ws IS NULL THEN
      RETURN NEW;
    END IF;

    v_captured := COALESCE(v_captured, false);
    IF v_captured THEN
      v_first := CASE WHEN jsonb_typeof(v_acq -> 'first') = 'object' THEN v_acq -> 'first' END;
      v_last  := CASE WHEN jsonb_typeof(v_acq -> 'last') = 'object' THEN v_acq -> 'last' END;
      v_touch := COALESCE(v_last, v_first);
      v_channel := public.acquisition_channel(
        v_touch,
        EXISTS (SELECT 1 FROM public.affiliate_referrals r WHERE r.workspace_id = v_ws));
      v_campaign := v_touch ->> 'utm_campaign';
    ELSE
      v_channel := 'unknown';
    END IF;

    BEGIN
      INSERT INTO public.workspace_acquisition
        (workspace_id, first_touch, last_touch, channel, campaign, captured)
      VALUES (v_ws, v_first, v_last, v_channel, v_campaign, v_captured)
      ON CONFLICT (workspace_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'workspace acquisition row skipped for user %: %', NEW.id, SQLERRM;
    END;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workspace acquisition skipped for user %: %', NEW.id, SQLERRM;
  END;

  -- Limpeza dos pendings órfãos em bloco próprio, depois da linha: um lock
  -- timeout ou deadlock aqui (dois cadastros limpando os mesmos órfãos) não
  -- desfaz a linha do workspace.
  BEGIN
    DELETE FROM public.acquisition_pending
     WHERE created_at < now() - interval '1 day';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'acquisition pending cleanup skipped for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_workspace_acquisition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_zzz_acquisition ON auth.users;
CREATE TRIGGER on_auth_user_created_zzz_acquisition
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.record_workspace_acquisition();

-- (5c) O GoTrue copia o metadata do cadastro (com acq cru, sem saneamento) em
-- auth.identities.identity_data no INSERT da identidade de e-mail e o regrava
-- depois (confirmação, recadastro). BEFORE INSERT OR UPDATE OF identity_data:
-- tira acq e nunca levanta erro nem devolve NULL (devolver NULL descartaria a
-- identidade em silêncio).
CREATE OR REPLACE FUNCTION public.strip_identity_acquisition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.identity_data ? 'acq' THEN
      NEW.identity_data := NEW.identity_data - 'acq';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'identity acquisition strip failed for identity %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.strip_identity_acquisition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_identity_acquisition_strip ON auth.identities;
CREATE TRIGGER on_auth_identity_acquisition_strip
  BEFORE INSERT OR UPDATE OF identity_data ON auth.identities
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_identity_acquisition();

-- (6) Ids da lista que já pagaram alguma vez.
CREATE OR REPLACE FUNCTION public.ever_paid_workspace_ids(p_ids uuid[])
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT x.id
    FROM unnest(p_ids) AS x(id)
   WHERE x.id IS NOT NULL
     AND (
       EXISTS (
         SELECT 1
           FROM public.workspace_subscription_snapshots s
          WHERE s.workspace_id = x.id
            AND s.monthly_cents > 0
            AND (s.status = 'active'
              OR (s.status = 'trialing' AND s.provider = 'pagarme' AND s.provider_switch))
       )
       OR EXISTS (
         SELECT 1
           FROM public.workspace_subscriptions ws
          WHERE ws.workspace_id = x.id
            AND ws.ever_subscribed_at IS NOT NULL
       )
       OR EXISTS (
         SELECT 1
           FROM public.workspaces w
          WHERE w.id = x.id
            AND w.reverse_trial_first_paid_at IS NOT NULL
       )
     );
$$;

REVOKE ALL ON FUNCTION public.ever_paid_workspace_ids(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ever_paid_workspace_ids(uuid[]) TO service_role;
