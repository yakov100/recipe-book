# Deferred cleanup — shared Supabase (Housing units)

Run **only after** recipe-book on `nuaepmndtblpmzbutowy` is verified in production for 48+ hours.

## Steps

1. Confirm production: login, AI chat, recipe save, shared `/recipe/:id` link.
2. Delete edge functions on **old** project only:
   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "<token>"
   npx supabase functions list --project-ref nklwzunoipplfkysaztl
   npx supabase functions delete recipe-ai --project-ref nklwzunoipplfkysaztl
   npx supabase functions delete regenerate-image --project-ref nklwzunoipplfkysaztl
   ```
   Also remove any UUID-named duplicate functions if still present.
3. Apply SQL (from repo root, linked to **old** project or via Dashboard SQL):
   ```powershell
   npx supabase link --project-ref nklwzunoipplfkysaztl
   Get-Content scripts/cleanup-old-shared-project.sql -Raw | npx supabase db query --linked
   ```
4. Empty and delete bucket `recipe-images` on old project (Storage UI).
5. Optional: remove recipe-book Redirect URLs from old project's URL Configuration.

**Do not** modify Housing units repo or its `config.js`.

Backup from split: `backups/pre-split-20250609/`
