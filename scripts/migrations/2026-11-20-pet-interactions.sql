CREATE TABLE IF NOT EXISTS pet_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_interactions_project_time_idx ON pet_interactions(project_id, created_at);
CREATE INDEX IF NOT EXISTS pet_interactions_actor_time_idx ON pet_interactions(actor_id, created_at);
