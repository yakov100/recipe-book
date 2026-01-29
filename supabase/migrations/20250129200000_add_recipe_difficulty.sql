-- Add difficulty column to recipes (1=קל, 2=בינוני, 3=קשה)
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS difficulty integer;

COMMENT ON COLUMN recipes.difficulty IS '1=קל, 2=בינוני, 3=קשה';
