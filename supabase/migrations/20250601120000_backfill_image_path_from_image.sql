-- Migration A: Backfill image_path from image (http/data URLs only)
-- Run before dropping image column. Base64 (data:...) is handled by app migrateLegacyBase64ToStorage.

UPDATE recipes
SET image_path = image
WHERE image_path IS NULL
  AND image IS NOT NULL
  AND (image LIKE 'http%' OR image LIKE 'data:%');
