-- Additive migration. Does not modify homes, users, project tasks or pet assets.
CREATE TABLE IF NOT EXISTS desktop_pet_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pairing_hash text NOT NULL UNIQUE,
  pairing_expires_at timestamp NOT NULL,
  session_hash text UNIQUE,
  expires_at timestamp NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_seen_at timestamp,
  command text NOT NULL DEFAULT 'show',
  command_sequence integer NOT NULL DEFAULT 0,
  ack_sequence integer NOT NULL DEFAULT 0,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS desktop_pet_user_idx ON desktop_pet_connections(user_id, created_at);
