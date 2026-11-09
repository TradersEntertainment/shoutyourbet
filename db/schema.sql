-- ShoutYourBet — PostgreSQL schema (Railway Postgres / Supabase compatible).
-- Idempotent: the API runs this on startup.
-- Token amounts are BIGINT base units ($SHOUT has 6 decimals: 1 SHOUT = 1_000_000).

create table if not exists users (
  wallet     text primary key,
  nickname   text not null,
  created_at timestamptz not null default now()
);

create table if not exists shouts (
  id            uuid primary key,
  room          text not null,
  identity      text not null,
  wallet        text references users(wallet),
  name          text not null,
  instrument_id text not null,
  side          text not null check (side in ('LONG','SHORT')),
  entry_price   double precision not null,
  created_at    timestamptz not null,
  resolve_at    timestamptz not null,
  exit_price    double precision,
  pct           double precision,
  points        integer,
  reward        bigint
);
create index if not exists shouts_due_idx on shouts (resolve_at) where exit_price is null;
create index if not exists shouts_room_idx on shouts (room, created_at);
create index if not exists shouts_created_idx on shouts (created_at);

-- Append-only off-chain balance. balance(wallet) = sum(amount).
create table if not exists ledger (
  id         bigserial primary key,
  wallet     text not null references users(wallet),
  amount     bigint not null,
  reason     text not null check (reason in ('reward','season','claim','claim_refund','purchase','admin')),
  ref        text not null,
  created_at timestamptz not null default now(),
  unique (reason, ref)
);
create index if not exists ledger_wallet_idx on ledger (wallet, created_at desc);

-- Withdrawals from the off-chain balance to the user's wallet.
create table if not exists claims (
  id         bigserial primary key,
  wallet     text not null references users(wallet),
  amount     bigint not null check (amount > 0),
  status     text not null check (status in ('pending','sent','failed')),
  tx_sig     text,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists claims_wallet_idx on claims (wallet, created_at desc);

-- Shop purchases paid on-chain (wallet -> treasury). tx_sig makes them idempotent.
create table if not exists purchases (
  tx_sig     text primary key,
  wallet     text not null references users(wallet),
  item_id    text not null,
  amount     bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists inventory (
  wallet  text not null references users(wallet),
  item_id text not null,
  qty     integer not null default 1 check (qty >= 0),
  primary key (wallet, item_id)
);

-- One-time sign-in nonces.
create table if not exists nonces (
  nonce      text primary key,
  expires_at timestamptz not null,
  used       boolean not null default false
);

create table if not exists reports (
  id         bigserial primary key,
  room       text not null,
  target     text not null,
  reporter   text not null,
  reason     text,
  created_at timestamptz not null default now()
);
