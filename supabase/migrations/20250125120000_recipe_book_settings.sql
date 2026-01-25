-- recipe_book_settings: required by main.js loadSettings/saveSetting
CREATE TABLE IF NOT EXISTS recipe_book_settings (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recipe_book_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon to manage recipe_book_settings"
  ON recipe_book_settings
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- recipes: allow user_id to be null for Edge Function inserts (service_role bypasses RLS)
DO $$
BEGIN
  ALTER TABLE recipes ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL; -- user_id may not exist in some setups
END
$$;

-- Align recipes columns with main.js: recipe_link, image (if DB has link, image_url from original migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'link')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'recipe_link') THEN
    ALTER TABLE recipes RENAME COLUMN link TO recipe_link;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'image_url')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'image') THEN
    ALTER TABLE recipes RENAME COLUMN image_url TO image;
  END IF;
END
$$;
