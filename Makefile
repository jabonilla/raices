.PHONY: verify typecheck lint test format install db-migrate

# typecheck and lint are independent — run them in parallel, then test.
# Saves ~12s (the shorter of the two) on every CI run.
verify:
	pnpm typecheck & pnpm lint & wait
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
