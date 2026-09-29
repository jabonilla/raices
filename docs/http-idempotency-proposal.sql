-- K3.5 PROPOSAL ONLY. NOT a migration and NOT run by the migration runner.
-- Requires K0 authorization: this is a non-identity HTTP receipt table.
create table http_request_receipt (
  scope_hash text primary key check (scope_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('started','completed')),
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check ((state='started' and outcome is null) or (state='completed' and outcome is not null))
);
grant select, insert, update on http_request_receipt to app;
revoke delete, truncate on http_request_receipt from app;
