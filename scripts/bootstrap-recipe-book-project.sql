-- Fresh bootstrap for dedicated recipe-book Supabase project (final schema)

CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text,
  ingredients text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'שונות',
  notes text,
  recipe_link text,
  video_url text,
  rating integer DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  preparation_time integer,
  image_path text,
  difficulty integer,
  dietary_type text,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON COLUMN recipes.image_path IS
  'Image reference: NULL, full URL (http/data), or Storage object key in bucket recipe-images.';
COMMENT ON COLUMN recipes.difficulty IS '1=קל, 2=בינוני, 3=קשה';
COMMENT ON COLUMN recipes.dietary_type IS 'Dietary type: חלבי / בשרי / פרווה';

CREATE INDEX IF NOT EXISTS idx_recipes_image_path ON recipes(image_path) WHERE image_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recipes_dietary_type ON recipes(dietary_type) WHERE dietary_type IS NOT NULL;

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own recipes"
  ON recipes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create recipes"
  ON recipes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own recipes"
  ON recipes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own recipes"
  ON recipes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION get_public_recipe(recipe_id uuid)
RETURNS SETOF recipes
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM recipes WHERE id = recipe_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_recipe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_recipe(uuid) TO anon, authenticated;

CREATE TABLE recipe_book_settings (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE recipe_book_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own recipe_book_settings"
  ON recipe_book_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'שיחה חדשה',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  message_count integer DEFAULT 0,
  last_message_preview text,
  user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES chat_conversations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  attachments jsonb DEFAULT '[]',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chat_conversations"
  ON chat_conversations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat_conversations"
  ON chat_conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chat_conversations"
  ON chat_conversations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat_conversations"
  ON chat_conversations FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can read own chat_messages"
  ON chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "Users can insert own chat_messages"
  ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "Users can update own chat_messages"
  ON chat_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "Users can delete own chat_messages"
  ON chat_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION update_conversation_metadata()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations SET
    updated_at = now(),
    message_count = (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = NEW.conversation_id),
    last_message_preview = LEFT(NEW.content, 100),
    title = CASE
      WHEN title = 'שיחה חדשה' AND NEW.role = 'user' THEN LEFT(NEW.content, 50)
      ELSE title
    END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION update_conversation_metadata();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recipe-images',
  'recipe-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view recipe images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'recipe-images');

CREATE POLICY "Authenticated users can upload recipe images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'recipe-images');

CREATE POLICY "Users can update recipe images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'recipe-images');

CREATE POLICY "Users can delete recipe images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'recipe-images');

CREATE OR REPLACE FUNCTION get_recipe_image_url(image_path TEXT)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN image_path IS NULL THEN NULL
    WHEN image_path LIKE 'http%' THEN image_path
    WHEN image_path LIKE 'data:%' THEN image_path
    ELSE current_setting('app.settings.supabase_url', true) || '/storage/v1/object/public/recipe-images/' || image_path
  END;
$$;
