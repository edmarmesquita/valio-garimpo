-- Banco exclusivo do Valiô Garimpo. Execute antes de publicar o OAuth persistente.
CREATE TABLE IF NOT EXISTS meli_connections (
  meli_user_id text PRIMARY KEY CHECK (meli_user_id ~ '^[0-9]+$'),
  nickname text,
  scope text,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_issued_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauth_required')),
  token_version bigint NOT NULL DEFAULT 1,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash char(64) PRIMARY KEY,
  meli_user_id text REFERENCES meli_connections(meli_user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_sessions_expires_at_idx
  ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS oauth_sessions_meli_user_id_idx
  ON oauth_sessions(meli_user_id);

CREATE TABLE IF NOT EXISTS oauth_attempts (
  state_hash char(64) PRIMARY KEY,
  session_hash char(64) NOT NULL REFERENCES oauth_sessions(session_hash) ON DELETE CASCADE,
  verifier_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_attempts_expires_at_idx
  ON oauth_attempts(expires_at);
