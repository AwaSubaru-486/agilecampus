-- Preserve legacy task associations without reusing them as product modules.
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS base_iteration_id uuid REFERENCES project_iterations(id) ON DELETE SET NULL;
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS execution_notes text NOT NULL DEFAULT '';
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS validation_notes text NOT NULL DEFAULT '';
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS release_url text NOT NULL DEFAULT '';
