CREATE TABLE IF NOT EXISTS dongoInternalNonce (
  nonce TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS dongoInternalNonce_expiresAt
  ON dongoInternalNonce (expiresAt);
