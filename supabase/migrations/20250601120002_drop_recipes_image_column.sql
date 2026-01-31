-- Migration C: Drop image column; single source of truth is image_path.
-- Run only after: (1) Migration A and B, (2) app migrateLegacyBase64ToStorage has run.
-- After running this migration, remove "image" from any SELECT on recipes in the app.

ALTER TABLE recipes DROP COLUMN IF EXISTS image;

COMMENT ON COLUMN recipes.image_path IS
  'Image reference: NULL (no image), full URL (http/data), or Storage object key in bucket recipe-images (e.g. uuid.jpg). Public URL = {SUPABASE_URL}/storage/v1/object/public/recipe-images/{image_path}.';
