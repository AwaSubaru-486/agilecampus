CREATE TABLE IF NOT EXISTS task_memory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  memory_id uuid NOT NULL,
  revision integer NOT NULL CONSTRAINT task_memory_versions_revision_positive CHECK (revision > 0),
  material_digest text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_memory_versions_identity_unique ON task_memory_versions(project_id, task_id, memory_id, revision);
CREATE INDEX IF NOT EXISTS task_memory_versions_task_created_idx ON task_memory_versions(project_id, task_id, created_at);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_memory_version_id uuid REFERENCES task_memory_versions(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS task_memory_version_id uuid REFERENCES task_memory_versions(id) ON DELETE SET NULL;
