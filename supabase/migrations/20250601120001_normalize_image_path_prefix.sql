-- Migration B: Normalize image_path – strip leading recipe-images/ for backward compatibility

UPDATE recipes
SET image_path = regexp_replace(image_path, '^recipe-images/', '')
WHERE image_path LIKE 'recipe-images/%';
