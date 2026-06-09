-- Migration B: DEPRECATED (no-op)
-- Do NOT strip leading recipe-images/ from image_path.
-- Some Storage objects use recipe-images/ as part of the object key inside the bucket;
-- removing the prefix breaks public URLs (HTTP 400).

-- Intentionally left as no-op for environments that have not yet applied this migration.
SELECT 1;
