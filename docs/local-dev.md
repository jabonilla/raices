# Local development

Four commands from a clean checkout to a seeded local database:

```sh
pnpm install
docker compose up -d db
export DATABASE_URL=postgres://raices:raices@localhost:5432/raices_dev
pnpm db:migrate && pnpm db:seed
```

That gives you Postgres 16 with all migrations applied and fixture data:
two accounts (`settlement:usd`, `recipient:maria`) and one balanced
$25.00 transfer between them. The seed is idempotent — run it again and
nothing changes.

## The safety guard

`pnpm db:migrate` and `pnpm db:seed` refuse any database whose name does
not end in `_test` or `_dev`. The guard runs before any connection is
opened, so a mispointed `DATABASE_URL` fails fast instead of migrating the
wrong database. The test suite has its own stricter guard (`tests/pg.ts`)
that requires `_test` exactly — tests never share a database with dev
fixtures.

## Useful extras

```sh
docker compose down        # stop the database (data persists in the pgdata volume)
docker compose down -v     # stop and delete all local data
psql postgres://raices:raices@localhost:5432/raices_dev
```
