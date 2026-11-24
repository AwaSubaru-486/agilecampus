-- NULL preserves legacy change-only versions. New workspaces freeze full module state.
ALTER TABLE project_iterations ADD COLUMN IF NOT EXISTS module_snapshot jsonb;
