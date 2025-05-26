/*
  # Create recipes schema

  1. New Tables
    - `recipes`
      - `id` (uuid, primary key)
      - `name` (text, not null)
      - `source` (text)
      - `ingredients` (text, not null)
      - `instructions` (text, not null)
      - `category` (text, not null)
      - `notes` (text)
      - `link` (text)
      - `video_url` (text)
      - `image_url` (text)
      - `rating` (integer)
      - `user_id` (uuid, foreign key to auth.users)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `recipes` table
    - Add policies for authenticated users to:
      - Read their own recipes
      - Create new recipes
      - Update their own recipes
      - Delete their own recipes
*/

CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text,
  ingredients text NOT NULL,
  instructions text NOT NULL,
  category text NOT NULL,
  notes text,
  link text,
  video_url text,
  image_url text,
  rating integer,
  user_id uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- Policy for users to read their own recipes
CREATE POLICY "Users can read own recipes"
  ON recipes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy for users to insert their own recipes
CREATE POLICY "Users can create recipes"
  ON recipes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy for users to update their own recipes
CREATE POLICY "Users can update own recipes"
  ON recipes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy for users to delete their own recipes
CREATE POLICY "Users can delete own recipes"
  ON recipes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);