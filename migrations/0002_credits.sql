-- Quarry hosted-credit ledger. Balance is integer USD cents of prepaid Quarry credit.
create table if not exists quarry_credits (
  user_id text primary key,
  balance_cents bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists quarry_credit_ledger (
  id text primary key,
  user_id text not null,
  delta_cents bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists quarry_credit_ledger_user_idx
  on quarry_credit_ledger (user_id, created_at desc);
