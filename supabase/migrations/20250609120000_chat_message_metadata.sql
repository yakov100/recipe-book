-- Persist AI chat extras (suggested recipes, add-to-book state) across sessions
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
