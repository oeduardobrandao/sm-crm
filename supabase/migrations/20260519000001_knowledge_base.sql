-- Knowledge Base: platform-level help articles for CRM users

CREATE TABLE IF NOT EXISTS kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  content jsonb,
  content_plain text NOT NULL DEFAULT '',
  cover_image_url text,
  category text NOT NULL,
  tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  display_order integer NOT NULL DEFAULT 0,
  author_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kb_articles_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS kb_articles_category ON kb_articles (category);
CREATE INDEX IF NOT EXISTS kb_articles_status ON kb_articles (status);
CREATE INDEX IF NOT EXISTS kb_articles_display_order ON kb_articles (display_order);
CREATE INDEX IF NOT EXISTS kb_articles_search ON kb_articles USING gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content_plain, ''))
);

CREATE OR REPLACE FUNCTION update_kb_articles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_articles_updated_at
  BEFORE UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read published articles"
  ON kb_articles FOR SELECT TO authenticated
  USING (status = 'published');

-- Contextual help: maps CRM routes to relevant articles
CREATE TABLE IF NOT EXISTS kb_context_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_pattern text NOT NULL,
  article_id uuid NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  label text,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (route_pattern, article_id)
);

ALTER TABLE kb_context_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read context links"
  ON kb_context_links FOR SELECT TO authenticated
  USING (true);

-- Enable RLS on platform_admins so CRM users can check their own admin status
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can check own admin status"
  ON platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());
