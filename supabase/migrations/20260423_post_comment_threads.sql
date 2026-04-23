-- Inline comment threads anchored to text selections in PostEditor
CREATE TABLE IF NOT EXISTS post_comment_threads (
  id            bigserial PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id      uuid NOT NULL,
  quoted_text   text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_by    uuid NOT NULL,
  resolved_by   uuid,
  created_at    timestamptz DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_post_comment_threads_post ON post_comment_threads(post_id);

CREATE TABLE IF NOT EXISTS post_comments (
  id            bigserial PRIMARY KEY,
  thread_id     bigint NOT NULL REFERENCES post_comment_threads(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL,
  content       text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_post_comments_thread ON post_comments(thread_id);

-- RLS for post_comment_threads
ALTER TABLE post_comment_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_comment_threads_select" ON post_comment_threads;
CREATE POLICY "post_comment_threads_select" ON post_comment_threads
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_insert" ON post_comment_threads;
CREATE POLICY "post_comment_threads_insert" ON post_comment_threads
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_update" ON post_comment_threads;
CREATE POLICY "post_comment_threads_update" ON post_comment_threads
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_delete" ON post_comment_threads;
CREATE POLICY "post_comment_threads_delete" ON post_comment_threads
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- RLS for post_comments (scoped via thread's conta_id)
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_comments_select" ON post_comments;
CREATE POLICY "post_comments_select" ON post_comments
  FOR SELECT USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_insert" ON post_comments;
CREATE POLICY "post_comments_insert" ON post_comments
  FOR INSERT WITH CHECK (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_update" ON post_comments;
CREATE POLICY "post_comments_update" ON post_comments
  FOR UPDATE USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  )
  WITH CHECK (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_delete" ON post_comments;
CREATE POLICY "post_comments_delete" ON post_comments
  FOR DELETE USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );
