-- Apply before deploying the interactive tutorial UI. Existing accounts are prompted once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_progress jsonb NOT NULL
  DEFAULT '{"status":"new","completed":[],"active":null}'::jsonb;
