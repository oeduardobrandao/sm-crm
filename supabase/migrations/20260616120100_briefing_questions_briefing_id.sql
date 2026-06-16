-- Nullable on purpose: an old/cached CRM bundle still inserts without briefing_id.
-- A NOT NULL constraint would break those inserts immediately after this runs.
-- Tightening to NOT NULL is a deferred follow-up migration (see spec rollout notes).
ALTER TABLE hub_briefing_questions
  ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES briefings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS hub_briefing_questions_briefing_id_idx
  ON hub_briefing_questions (briefing_id);

-- Backfill: one untitled briefing per client that already has questions
-- (empty title so the agency can name it later), then point that client's questions at it.
DO $$
DECLARE
  rec RECORD;
  new_briefing_id uuid;
BEGIN
  FOR rec IN
    SELECT cliente_id, conta_id
    FROM hub_briefing_questions
    WHERE briefing_id IS NULL
    GROUP BY cliente_id, conta_id
  LOOP
    INSERT INTO briefings (cliente_id, conta_id, title, display_order)
    VALUES (rec.cliente_id, rec.conta_id, '', 0)
    RETURNING id INTO new_briefing_id;

    UPDATE hub_briefing_questions
    SET briefing_id = new_briefing_id
    WHERE cliente_id = rec.cliente_id AND briefing_id IS NULL;
  END LOOP;
END $$;
