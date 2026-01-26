-- Fix: Allow anon access to recipes table
-- The app uses anon key (not authenticated), so we need policies for anon role

-- Allow anon to read all recipes (since the app doesn't use user authentication)
CREATE POLICY "Allow anon to read recipes"
  ON recipes
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to insert recipes (user_id can be null per migration 20250125120000)
CREATE POLICY "Allow anon to insert recipes"
  ON recipes
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon to update recipes
CREATE POLICY "Allow anon to update recipes"
  ON recipes
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anon to delete recipes
CREATE POLICY "Allow anon to delete recipes"
  ON recipes
  FOR DELETE
  TO anon
  USING (true);
