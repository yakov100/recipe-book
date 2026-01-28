-- Migration: Add Supabase Storage for recipe images
-- Date: 2025-01-28
-- Purpose: Replace base64 images with Supabase Storage URLs

-- ============================================
-- Step 1: Create Storage Bucket
-- ============================================

-- Create bucket for recipe images (public bucket)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recipe-images',
  'recipe-images',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Step 2: Storage RLS Policies
-- ============================================

-- Allow public to view/download recipe images
CREATE POLICY IF NOT EXISTS "Public can view recipe images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'recipe-images');

-- Allow authenticated users to upload images
CREATE POLICY IF NOT EXISTS "Authenticated users can upload recipe images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'recipe-images');

-- Allow anonymous users to upload images (for guest mode)
CREATE POLICY IF NOT EXISTS "Anonymous users can upload recipe images"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'recipe-images');

-- Allow users to update their own images
-- Note: Storage doesn't track user ownership by default, so we allow all updates
CREATE POLICY IF NOT EXISTS "Users can update recipe images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'recipe-images');

-- Allow users to delete images
CREATE POLICY IF NOT EXISTS "Users can delete recipe images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'recipe-images');

-- Allow anonymous to delete (for guest mode cleanup)
CREATE POLICY IF NOT EXISTS "Anonymous can delete recipe images"
ON storage.objects FOR DELETE
TO anon
USING (bucket_id = 'recipe-images');

-- ============================================
-- Step 3: Add image_path column to recipes
-- ============================================

-- Add new column for storage path
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS image_path TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_recipes_image_path 
ON recipes(image_path)
WHERE image_path IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN recipes.image_path IS 
  'Path to image in Supabase Storage bucket "recipe-images". Replaces base64 image column for better performance.';

-- ============================================
-- Step 4: Helper function (optional)
-- ============================================

-- Function to get full image URL from storage path
CREATE OR REPLACE FUNCTION get_recipe_image_url(image_path TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN image_path IS NULL THEN NULL
    WHEN image_path LIKE 'http%' THEN image_path
    WHEN image_path LIKE 'data:%' THEN image_path
    ELSE current_setting('app.settings.supabase_url', true) || '/storage/v1/object/public/recipe-images/' || image_path
  END;
$$;

COMMENT ON FUNCTION get_recipe_image_url IS 
  'Converts storage path to full public URL. Handles legacy base64 and external URLs.';
