.PHONY: verify typecheck lint test format install db-migrate probe-deployed

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

# Probe a deployed API (K2.50). BASE_URL is required and must be HTTPS.
# Exits non-zero on any failure or UNVERIFIED check — an unproven security
# property holds the gate red, it is not waved through.
probe-deployed:
ifndef BASE_URL
	$(error BASE_URL is required, e.g. make probe-deployed BASE_URL=https://api-production-9b18.up.railway.app)
endif
	node scripts/k3-deployed-probe.mjs
