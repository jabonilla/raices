.PHONY: verify typecheck lint test format install db-migrate

verify:
	pnpm typecheck && pnpm lint && pnpm test

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
