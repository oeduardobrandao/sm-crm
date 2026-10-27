-- Linha editorial: rows may be dated outside the linha's month (a post planned for the
-- first days of the next month stays in this month's plan). Drops the
-- linha_item_data_fora_do_mes check from linha_item_guard (20261031000001); everything
-- else in the guard is unchanged. With the date no longer checked against the parent,
-- an UPDATE never needs the parent row: linha_id and conta_id are immutable.

CREATE OR REPLACE FUNCTION public.linha_item_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conta   uuid;
  v_total   integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A row can't move to another linha (another client's) or another conta
    -- (follows post_move_requires_rpc, 20260830000001).
    IF NEW.linha_id IS DISTINCT FROM OLD.linha_id THEN
      RAISE EXCEPTION 'linha_item_linha_imutavel';
    END IF;
    IF NEW.conta_id IS DISTINCT FROM OLD.conta_id THEN
      RAISE EXCEPTION 'linha_item_conta_imutavel';
    END IF;
    -- Converted rows are frozen: the post is the source of truth. Only while post_id stays
    -- the same, so the FK's ON DELETE SET NULL (itself an UPDATE) releases the row.
    IF OLD.post_id IS NOT NULL
       AND NEW.post_id IS NOT DISTINCT FROM OLD.post_id
       AND (NEW.data, NEW.tipo, NEW.titulo, NEW.direcao, NEW.valores)
           IS DISTINCT FROM (OLD.data, OLD.tipo, OLD.titulo, OLD.direcao, OLD.valores) THEN
      RAISE EXCEPTION 'linha_item_convertido';
    END IF;
    RETURN NEW;
  END IF;

  SELECT l.conta_id INTO v_conta
    FROM public.linhas_editoriais l
   WHERE l.id = NEW.linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'linha_nao_encontrada';
  END IF;
  IF v_conta IS DISTINCT FROM NEW.conta_id THEN
    RAISE EXCEPTION 'linha_item_conta_divergente';
  END IF;

  -- Serialize inserts per linha so two concurrent ones can't both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext('linha_editorial_itens:' || NEW.linha_id::text));
  SELECT count(*) INTO v_total FROM public.linha_editorial_itens WHERE linha_id = NEW.linha_id;
  IF v_total >= 100 THEN
    RAISE EXCEPTION 'linha_item_limite';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.linha_item_guard() FROM PUBLIC, anon, authenticated;
