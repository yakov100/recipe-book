-- Run ONLY on shared project nklwzunoipplfkysaztl AFTER 48h production validation on nuaepmndtblpmzbutowy.
-- Does NOT touch Housing / weight / summaries / birthdays tables.

-- Edge functions (remove via CLI instead — safer):
-- npx supabase functions delete recipe-ai --project-ref nklwzunoipplfkysaztl
-- npx supabase functions delete regenerate-image --project-ref nklwzunoipplfkysaztl

DROP POLICY IF EXISTS "Users can read own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can update own chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat_messages" ON chat_messages;

DROP POLICY IF EXISTS "Users can read own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can insert own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can update own chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Users can delete own chat_conversations" ON chat_conversations;

DROP POLICY IF EXISTS "Users can manage own recipe_book_settings" ON recipe_book_settings;

DROP POLICY IF EXISTS "Users can read own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can create recipes" ON recipes;
DROP POLICY IF EXISTS "Users can update own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can delete own recipes" ON recipes;

DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS recipe_book_settings CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;

DROP FUNCTION IF EXISTS get_public_recipe(uuid);
DROP FUNCTION IF EXISTS update_conversation_metadata() CASCADE;
DROP FUNCTION IF EXISTS update_recipes_updated_at() CASCADE;

-- Storage bucket: delete objects first in Dashboard or Storage API, then:
-- DELETE FROM storage.buckets WHERE id = 'recipe-images';
