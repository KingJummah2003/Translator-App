-- Welcome credits are given once per email address, even if the account is deleted and
-- recreated. Only a keyed hash (HMAC with the server secret) of the normalised address is
-- kept, so the address itself can't be recovered from this table.
CREATE TABLE welcome_grant (
  email_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Free-tier usage is counted separately so free accounts can't use up the whole daily budget.
ALTER TABLE usage_global_daily ADD COLUMN free_chars INTEGER NOT NULL DEFAULT 0;
