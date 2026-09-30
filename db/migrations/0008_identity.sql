-- K3.4: identity and session tables only. Existing domain/audit tables untouched.
create table identity_challenge (
  id uuid primary key,
  phone text not null check (user_is_e164(phone)),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('active','used','locked','expired','delivery_failed')),
  failures integer not null default 0 check (failures >= 0),
  max_failures integer not null check (max_failures between 1 and 20),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at >= created_at)
);
create index identity_challenge_phone_idx on identity_challenge(phone, created_at);
select audit_enforce_transitions('identity_challenge', 'state', 'identity_challenge');

create table identity_phone_guard (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  locked_until timestamptz
);
create table identity_rate_bucket (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits > 0)
);
create table identity_principal (
  user_id uuid primary key references app_user(id),
  generation bigint not null check (generation > 0)
);
create table identity_session (
  id uuid primary key,
  user_id uuid not null references app_user(id),
  challenge_id uuid not null unique references identity_challenge(id),
  generation bigint not null check (generation > 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('active','revoked')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at >= created_at)
);
create index identity_session_user_idx on identity_session(user_id);
select audit_enforce_transitions('identity_session', 'state', 'identity_session');

-- Audit-only events, e.g. an unknown challenge or a rate-limit decision.
-- transition() writes this row and the existing audit row atomically.
create table identity_security_event (
  id uuid primary key,
  state text not null check (state = 'recorded'),
  created_at timestamptz not null default clock_timestamp()
);
grant select, insert, update on identity_challenge, identity_phone_guard, identity_rate_bucket,
  identity_principal, identity_session to app;
grant select, insert on identity_security_event to app;
revoke delete, truncate on identity_challenge, identity_phone_guard, identity_rate_bucket,
  identity_principal, identity_session, identity_security_event from app;
