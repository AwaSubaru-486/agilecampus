CREATE TABLE IF NOT EXISTS task_memory_continuations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES task_memory_versions(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'waiting',
  sequence integer NOT NULL DEFAULT 0,
  claim_id uuid,
  attempt_id uuid,
  events jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_memory_continuations_requester_idx ON task_memory_continuations(requester_id, project_id, task_id, created_at);
