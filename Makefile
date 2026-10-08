.PHONY: verify typecheck lint test format install db-migrate

# Run serially. These were parallelised with `pnpm typecheck & pnpm lint & wait`,
# and a bare `wait` returns 0 regardless of its children's exit statuses — so
# typecheck and lint failures were silently discarded and `make verify` passed
# while main carried a type error and nine lint errors (CI-1, docs/ci-claims-audit.md).
# The ~12s saved was not worth a verification command that cannot fail.
# If this is ever parallelised again, the exit status of EVERY child must be
# captured and checked, and the change must be proven by breaking a type on
# purpose and confirming CI goes red.
verify:
	pnpm typecheck
	pnpm lint
	pnpm test

install:
	pnpm install --frozen-lockfile

typecheck:
	pnpm typecheck

lint:
	pnpm lint

test:
	pnpm test

format:
	pnpm format

db-migrate:
	pnpm db:migrate
