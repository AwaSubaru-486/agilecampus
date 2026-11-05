ALTER TABLE home_profiles ADD COLUMN IF NOT EXISTS working_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
