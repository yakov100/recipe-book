-- Add dietary_type column to recipes (חלבי/בשרי/פרווה)
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS dietary_type text;

COMMENT ON COLUMN recipes.dietary_type IS 'Dietary type: חלבי / בשרי / פרווה';

CREATE INDEX IF NOT EXISTS idx_recipes_dietary_type
ON recipes(dietary_type)
WHERE dietary_type IS NOT NULL;
