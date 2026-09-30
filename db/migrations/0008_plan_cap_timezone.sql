-- Issue #92 — a monthly cap needs a month boundary, and a month boundary
-- needs a timezone.
--
-- The sender is in the US and the recipient is in Guatemala. Guatemala is
-- UTC-6 year round with no DST; US senders are UTC-4 to UTC-10 depending on
-- where and when. So the two month boundaries are hours apart, and the gap
-- moves twice a year. A request at 23:30 on the 31st in Guatemala is already
-- the 1st in New York: under one clock it counts against a nearly-spent
-- month and waits for a person, under the other it starts a fresh month and
-- auto-approves. Same request, same amounts.
--
-- The decision: the timezone is a property of the agreement, stored on the
-- plan version. Never inferred from whatever device is making the request —
-- a recipient travelling, or a sender's phone set to UTC, must not silently
-- move the boundary. And because plan_version is immutable (0005), changing
-- it appends a new version like any other plan change, so a request already
-- classified cannot be reclassified by a later decision.

-- Existing rows predate the decision and have no answer of their own. They
-- get Guatemala, because the cap governs spending that happens there, and
-- the default is dropped immediately afterwards so that every version
-- written from now on has to say what it means.
alter table plan_version
  add column cap_timezone text not null default 'America/Guatemala';

alter table plan_version
  alter column cap_timezone drop default;

-- A zone name, not an offset. "-06:00" is Guatemala today and wrong the
-- moment any rule changes; "America/Guatemala" carries its own history, so
-- a window computed over a past month stays correct.
--
-- Validated against the catalogue rather than a regex: Postgres is the thing
-- that will do the arithmetic, so its opinion of what is a zone is the one
-- that matters. A trigger rather than a CHECK because pg_timezone_names is a
-- view and cannot be read from a constraint.
create or replace function plan_version_check_cap_timezone() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.cap_timezone) then
    raise exception
      'cap timezone % is not an IANA zone name known to this server', new.cap_timezone
      using errcode = 'TZ001',
            hint = 'Use a zone name such as America/Guatemala, never a fixed offset.';
  end if;

  return null;
end
$$;

create constraint trigger plan_version_cap_timezone_valid
  after insert on plan_version
  for each row execute function plan_version_check_cap_timezone();

-- No trigger for UPDATE: plan_version is immutable (0005's PL001 triggers
-- refuse every update), so the only way a version's timezone changes is by
-- appending a new version.
