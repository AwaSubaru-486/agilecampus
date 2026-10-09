CREATE TABLE IF NOT EXISTS task_handoff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_submission_at timestamp NOT NULL,
  source_title text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  dismissed_at timestamp
);
CREATE INDEX IF NOT EXISTS handoff_inbox_recipient_idx ON task_handoff_notifications(recipient_id, dismissed_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS handoff_inbox_delivery_unique ON task_handoff_notifications(recipient_id, task_id, source_task_id, source_submission_at);
