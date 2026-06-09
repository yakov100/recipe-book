-- User auth isolation: Google OAuth, per-user data, public share RPC
-- Clears existing shared data per product decision.

-- ============================================
-- 1. Clean existing shared data
-- ============================================
DELETE FROM chat_messages;
DELETE FROM chat_conversations;
DELETE FROM recipes;
DELETE FROM recipe_book_settings;

-- Ensure recipes.user_id exists (remote schema may omit it)
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users;

-- ============================================
-- 2. Recipes: require owner, remove anon access
-- ============================================
DROP POLICY IF EXISTS "Allow anon to read recipes" ON recipes;
DROP POLICY IF EXISTS "Allow anon to insert recipes" ON recipes;
DROP POLICY IF EXISTS "Allow anon to update recipes" ON recipes;
DROP POLICY IF EXISTS "Allow anon to delete recipes" ON recipes;

DROP POLICY IF EXISTS "Users can read own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can create recipes" ON recipes;
DROP POLICY IF EXISTS "Users can update own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can delete own recipes" ON recipes;

CREATE POLICY "Users can read own recipes"
  ON recipes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create recipes"
  ON recipes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recipes"
  ON recipes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own recipes"
  ON recipes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE recipes ALTER COLUMN user_id SET NOT NULL;

-- Public read for shared links (single recipe by id only, via RPC)
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

-- ============================================
-- 3. Chat: per-user conversations
-- ============================================
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users;

ALTER TABLE chat_conversations ALTER COLUMN user_id SET NOT NULL;

DROP POLICY IF EXISTS "Allow anon to read chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to insert chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to update chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to delete chat_conversations" ON chat_conversations;

DROP POLICY IF EXISTS "Users can read own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can insert own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can update own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can delete own chat_conversations" ON chat_conversations;

CREATE POLICY "Users can read own chat_conversations"
  ON chat_conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat_conversations"
  ON chat_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chat_conversations"
  ON chat_conversations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat_conversations"
  ON chat_conversations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow anon to read chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to insert chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to update chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to delete chat_messages" ON chat_messages;

DROP POLICY IF EXISTS "Users can read own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can update own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat_messages" ON chat_messages;

CREATE POLICY "Users can read own chat_messages"
  ON chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own chat_messages"
  ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own chat_messages"
  ON chat_messages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own chat_messages"
  ON chat_messages FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- ============================================
-- 4. Settings: per-user key/value
-- ============================================
ALTER TABLE recipe_book_settings
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users;

ALTER TABLE recipe_book_settings DROP CONSTRAINT IF EXISTS recipe_book_settings_pkey;

ALTER TABLE recipe_book_settings ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE recipe_book_settings
  ADD CONSTRAINT recipe_book_settings_pkey PRIMARY KEY (user_id, key);

DROP POLICY IF EXISTS "Allow anon to manage recipe_book_settings" ON recipe_book_settings;

DROP POLICY IF EXISTS "Users can manage own recipe_book_settings" ON recipe_book_settings;

CREATE POLICY "Users can manage own recipe_book_settings"
  ON recipe_book_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 5. Storage: authenticated upload/delete only
-- ============================================
DROP POLICY IF EXISTS "Anonymous users can upload recipe images" ON storage.objects;
DROP POLICY IF EXISTS "Anonymous can delete recipe images" ON storage.objects;
