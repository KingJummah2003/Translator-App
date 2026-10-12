-- Subscriptions, purchases, credits and usage metering.
-- Times are milliseconds since the Unix epoch (UTC).
-- Privacy: no table stores the text users translate.

-- One row per user: their current Pro or VIP subscription as reported by the store.
CREATE TABLE subscription (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('pro', 'vip')),
  product_id TEXT NOT NULL,
  store TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'billing_issue', 'expired', 'refunded')),
  will_renew INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  original_transaction_id TEXT,
  environment TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX subscription_expires ON subscription (expires_at);

-- Every store transaction. Kept (without the user link) after account deletion for accounting.
CREATE TABLE purchase (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'credits', 'pass')),
  store TEXT,
  transaction_id TEXT NOT NULL UNIQUE,
  environment TEXT,
  price_usd REAL,
  purchased_at INTEGER NOT NULL,
  refunded_at INTEGER
);
CREATE INDEX purchase_user ON purchase (user_id, purchased_at);
CREATE INDEX purchase_time ON purchase (purchased_at);

-- 3-hour session passes. Bought passes wait as 'available' until the user starts one.
CREATE TABLE session_pass (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  purchase_id TEXT REFERENCES purchase(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'active', 'refunded')),
  activated_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX session_pass_user ON session_pass (user_id, status);

-- Spendable credits. See packages/shared/src/plans.ts for how buckets are spent.
CREATE TABLE credit_bucket (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pass', 'sub_daily', 'vip_weekly', 'grant', 'purchased')),
  balance INTEGER NOT NULL CHECK (balance >= 0),
  expires_at INTEGER,
  period_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, period_key)
);
CREATE INDEX credit_bucket_expiry ON credit_bucket (expires_at);

-- Append-only record of every credit change, for support and the admin portal.
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bucket_kind TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  actor TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_ledger_user ON credit_ledger (user_id, created_at);

-- Daily counters per user and action. Counts only, never content.
CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, action)
);
CREATE INDEX usage_daily_user ON usage_daily (user_id, day);

-- Whole-service counters, used for the daily cost cap.
CREATE TABLE usage_global_daily (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  ocr_images INTEGER NOT NULL DEFAULT 0
);

-- RevenueCat webhook deliveries, so a retried event is applied only once.
CREATE TABLE webhook_event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  app_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'ignored', 'failed')),
  error TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX webhook_event_time ON webhook_event (received_at);

-- Runtime switches the admin portal can change without a deploy.
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- Every action taken in the admin portal. Not linked to user rows so it survives deletion.
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_audit_time ON admin_audit (created_at);
CREATE INDEX admin_audit_target ON admin_audit (target_user_id, created_at);
