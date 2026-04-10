ALTER TABLE hub_briefing_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hub_briefing_questions_select" ON hub_briefing_questions;
CREATE POLICY "hub_briefing_questions_select" ON hub_briefing_questions
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "hub_briefing_questions_insert" ON hub_briefing_questions;
CREATE POLICY "hub_briefing_questions_insert" ON hub_briefing_questions
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "hub_briefing_questions_update" ON hub_briefing_questions;
CREATE POLICY "hub_briefing_questions_update" ON hub_briefing_questions
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS "hub_briefing_questions_delete" ON hub_briefing_questions;
CREATE POLICY "hub_briefing_questions_delete" ON hub_briefing_questions
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
  );
