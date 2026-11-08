-- ShoutYourBet — Supabase/Postgres schema (Faz 2: in-memory store -> Supabase)
create table if not exists profiles (
  identity   text primary key,          -- guest uuid now, auth.users.id later
  nickname   text not null,
  created_at timestamptz not null default now()
);

create table if not exists rooms (
  name          text primary key,       -- LiveKit room name (inst-BTC, u-xxxx)
  title         text not null,
  instrument_id text not null,
  mode          text not null check (mode in ('open','stage')),
  official      boolean not null default false,
  host_identity text references profiles(identity),
  host_key_hash text,
  created_at    timestamptz not null default now()
);

create table if not exists shouts (
  id            uuid primary key default gen_random_uuid(),
  room          text not null references rooms(name) on delete cascade,
  identity      text not null references profiles(identity),
  name          text not null,
  instrument_id text not null,
  side          text not null check (side in ('LONG','SHORT')),
  entry_price   double precision not null,
  created_at    timestamptz not null default now(),
  resolve_at    timestamptz not null,
  exit_price    double precision,
  pct           double precision,
  points        integer
);
create index if not exists shouts_due_idx on shouts (resolve_at) where exit_price is null;
create index if not exists shouts_room_idx on shouts (room, created_at);

create table if not exists reports (
  id         bigserial primary key,
  room       text not null,
  target     text not null,
  reporter   text not null,
  reason     text,
  created_at timestamptz not null default now()
);

-- daily leaderboard
create or replace view leaderboard_today as
select identity, max(name) as name, sum(points) as points,
       count(*) filter (where pct > 0) as wins,
       count(*) filter (where pct <= 0) as losses,
       min(pct) as worst_pct
from shouts
where exit_price is not null and created_at >= date_trunc('day', now() at time zone 'utc')
group by identity
order by points desc;
