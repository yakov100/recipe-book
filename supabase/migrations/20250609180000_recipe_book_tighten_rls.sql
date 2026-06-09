-- Recipe-book only: remove legacy permissive policy left after user_auth_isolation
DROP POLICY IF EXISTS "Allow all access to recipes" ON recipes;
