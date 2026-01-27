-- Chat History Tables for AI Chat
-- This migration adds tables for persisting chat conversations

-- Table: chat_conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'שיחה חדשה',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  message_count integer DEFAULT 0,
  last_message_preview text
);

-- Table: chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES chat_conversations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  attachments jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Index for faster message retrieval
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);

-- Enable RLS
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for anonymous access (same pattern as recipes table)
DROP POLICY IF EXISTS "Allow anon to read chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to insert chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to update chat_conversations" ON chat_conversations;
DROP POLICY IF EXISTS "Allow anon to delete chat_conversations" ON chat_conversations;

CREATE POLICY "Allow anon to read chat_conversations" ON chat_conversations FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert chat_conversations" ON chat_conversations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update chat_conversations" ON chat_conversations FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete chat_conversations" ON chat_conversations FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon to read chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to insert chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to update chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "Allow anon to delete chat_messages" ON chat_messages;

CREATE POLICY "Allow anon to read chat_messages" ON chat_messages FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert chat_messages" ON chat_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update chat_messages" ON chat_messages FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete chat_messages" ON chat_messages FOR DELETE TO anon USING (true);

-- Trigger function to auto-update conversation metadata when a message is added
CREATE OR REPLACE FUNCTION update_conversation_metadata()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations SET
    updated_at = now(),
    message_count = (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = NEW.conversation_id),
    last_message_preview = LEFT(NEW.content, 100),
    title = CASE
      WHEN title = 'שיחה חדשה' AND NEW.role = 'user'
      THEN LEFT(NEW.content, 50)
      ELSE title
    END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_conversation ON chat_messages;
CREATE TRIGGER trigger_update_conversation
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION update_conversation_metadata();
