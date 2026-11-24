ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS outcome_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
