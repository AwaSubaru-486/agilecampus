CREATE TABLE IF NOT EXISTS project_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version text NOT NULL,
  title text NOT NULL,
  goal text NOT NULL DEFAULT '',
  release_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CONSTRAINT project_iterations_status_check CHECK (status IN ('planned', 'active', 'released')),
  start_date date,
  end_date date,
  released_at timestamp,
  task_snapshot jsonb,
  created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT project_iterations_dates_check CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_iterations_version_unique ON project_iterations(project_id, version);
CREATE INDEX IF NOT EXISTS project_iterations_project_idx ON project_iterations(project_id, created_at);
CREATE TABLE IF NOT EXISTS iteration_tasks (
  iteration_id uuid NOT NULL REFERENCES project_iterations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (iteration_id, task_id)
);
CREATE INDEX IF NOT EXISTS iteration_tasks_task_idx ON iteration_tasks(task_id);
