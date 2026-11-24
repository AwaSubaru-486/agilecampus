ALTER TABLE home_profiles ADD COLUMN IF NOT EXISTS working_team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
