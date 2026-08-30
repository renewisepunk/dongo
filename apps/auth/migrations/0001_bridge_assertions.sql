CREATE TABLE IF NOT EXISTS dongoBridgeAssertion (
  jti TEXT PRIMARY KEY NOT NULL,
  profileId TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  consumedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS dongoBridgeAssertion_expiresAt
  ON dongoBridgeAssertion (expiresAt);
