CREATE TABLE IF NOT EXISTS user_model_configs (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  model text NOT NULL,
  encrypted_key text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
