-- ShoutYourBet — PostgreSQL schema (Railway Postgres / Supabase compatible).
-- Idempotent: the API runs this on startup.
-- Token amounts are BIGINT base units ($SHOUT has 6 decimals: 1 SHOUT = 1_000_000).

create table if not exists users (
  wallet       text primary key,
  nickname     text not null,
  created_at   timestamptz not null default now()
);
-- talk-to-earn state
alter table users add column if not exists equipped_mic text;
alter table users add column if not exists energy       double precision not null default 0;
alter table users add column if not exists energy_at    timestamptz not null default now();

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

-- Append-only off-chain balances for both tokens. balance(wallet, currency) = sum(amount).
-- amount is in base units of that currency ($SHOUT 6 decimals, $SPEAK 2 decimals).
create table if not exists ledger (
  id         bigserial primary key,
  wallet     text not null references users(wallet),
  currency   text not null default 'SHOUT',
  amount     bigint not null,
  reason     text not null,
  ref        text not null,
  created_at timestamptz not null default now()
);
alter table ledger add column if not exists currency text not null default 'SHOUT';
alter table ledger drop constraint if exists ledger_reason_check;
alter table ledger drop constraint if exists ledger_reason_ref_key;
create unique index if not exists ledger_reason_ref_currency on ledger (reason, ref, currency);
create index if not exists ledger_wallet_cur_idx on ledger (wallet, currency, created_at desc);

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
alter table claims add column if not exists currency text not null default 'SHOUT';
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

-- Mic NFTs (Metaplex Core assets). Ownership is synced from chain; game stats live here.
create sequence if not exists mic_serial;
create table if not exists mics (
  asset       text primary key,
  serial      integer not null unique default nextval('mic_serial'),
  owner       text not null,
  type        text not null,
  quality     text not null,
  level       integer not null default 0,
  points      integer not null default 0,
  efficiency  double precision not null,
  luck        double precision not null,
  resilience  double precision not null,
  charisma    double precision not null,
  durability  double precision not null default 100,
  mint_count  integer not null default 0,
  parent_a    text,
  parent_b    text,
  origin      text not null default 'factory',
  created_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);
create index if not exists mics_owner_idx on mics (owner);

-- Verified talk, flushed in chunks by the talk bot.
create table if not exists talk_chunks (
  id          uuid primary key,
  wallet      text not null references users(wallet),
  mic         text not null references mics(asset),
  room        text not null,
  seconds     integer not null,
  listeners   integer not null,
  speak       bigint not null,
  energy_used double precision not null,
  wear        double precision not null,
  created_at  timestamptz not null default now()
);
create index if not exists talk_wallet_idx on talk_chunks (wallet, created_at desc);
