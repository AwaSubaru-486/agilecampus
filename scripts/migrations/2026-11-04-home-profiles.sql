-- Additive home migration, missing from the original home feature upload.
CREATE TABLE IF NOT EXISTS home_profiles (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '我的小小家园',
  welcome text NOT NULL DEFAULT '欢迎来坐坐，和小伙伴一起歇一会儿。',
  theme text NOT NULL DEFAULT 'meadow',
  visibility text NOT NULL DEFAULT 'team',
  furniture jsonb NOT NULL DEFAULT '[]'::jsonb,
  pet jsonb NOT NULL DEFAULT '{"name":"团子","kind":"cat"}'::jsonb,
  pet_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS home_profiles_pet_team_idx ON home_profiles(pet_team_id);
