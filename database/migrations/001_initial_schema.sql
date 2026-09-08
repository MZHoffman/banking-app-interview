CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
  password_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_canonical CHECK (email = lower(trim(email)))
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  last_activity_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  account_number TEXT NOT NULL UNIQUE,
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The API validates this too (server/src/app.ts). The constraint is what
  -- stops a script, a migration or future code storing a malformed number.
  CONSTRAINT accounts_number_format CHECK (account_number ~ '^[1-9][0-9]{4}$')
);

CREATE TABLE money_transactions (
  id UUID PRIMARY KEY,
  idempotency_key UUID NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  source_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  initiated_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT money_transactions_shape CHECK (
    (type = 'deposit' AND source_account_id IS NULL AND destination_account_id IS NOT NULL)
    OR
    (type = 'withdrawal' AND source_account_id IS NOT NULL AND destination_account_id IS NULL)
    OR
    (
      type = 'transfer'
      AND source_account_id IS NOT NULL
      AND destination_account_id IS NOT NULL
      AND source_account_id <> destination_account_id
    )
  )
);

CREATE INDEX money_transactions_source_idx
  ON money_transactions(source_account_id, created_at DESC);
CREATE INDEX money_transactions_destination_idx
  ON money_transactions(destination_account_id, created_at DESC);
CREATE INDEX money_transactions_initiator_idx
  ON money_transactions(initiated_by_user_id, created_at DESC);
