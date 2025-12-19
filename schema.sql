CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  txn_id TEXT,
  status TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Users table for KYC registry
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email_or_phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sender', 'receiver')),
  bank_id TEXT NOT NULL,
  public_key_jwk JSONB NOT NULL,
  kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email_or_phone, role),
  UNIQUE(bank_id, role)
);

CREATE INDEX IF NOT EXISTS idx_users_email_phone ON users(email_or_phone);
CREATE INDEX IF NOT EXISTS idx_users_bank_id ON users(bank_id);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);

-- Wallets table for pre-funded offline wallets
CREATE TABLE IF NOT EXISTS wallets (
  wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  approved_limit DECIMAL(15, 2) NOT NULL DEFAULT 0,
  current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
  used_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  locked_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);

-- Settled transactions table
CREATE TABLE IF NOT EXISTS settled_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id TEXT NOT NULL UNIQUE,
  wallet_id UUID NOT NULL REFERENCES wallets(wallet_id) ON DELETE RESTRICT,
  from_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  to_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  amount DECIMAL(15, 2) NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ledger_index INTEGER,
  receiver_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_settled_txn_id ON settled_transactions(txn_id);
CREATE INDEX IF NOT EXISTS idx_settled_wallet_id ON settled_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_settled_settled_at ON settled_transactions(settled_at DESC);

