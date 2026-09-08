# Banking App

A small banking application. Sign in, view your current account, deposit, withdraw,
and transfer money to another account.

React and Vite on the front end, Express and PostgreSQL behind it.

## Requirements

- Node.js 24 (the version is pinned in `.nvmrc`)
- npm
- A PostgreSQL server running locally

## Getting started

```sh
npm install
npm run db:setup
npm run dev
```

The app opens at http://localhost:47831 and the API server listens on port 47832.

`npm run db:setup` creates the configured database (default: `banking_app`), applies the
migrations in `database/migrations/`, and inserts the demo accounts below. The
PostgreSQL role needs `CREATEDB` permission for this.

### Connecting to PostgreSQL

The project looks for PostgreSQL on port 47833. If yours listens elsewhere, copy
`.env.example` to `.env` and set what you need:

```text
POSTGRES_PORT=5432
POSTGRES_USER=your-local-postgres-role
```

If your role cannot create databases, create it with an administrator account and
run setup again:

```sh
createdb -h localhost -p 47833 banking_app
npm run db:setup
```

## Signing in

| Name         | Email                       | Password           | Account number |
| ------------ | --------------------------- | ------------------ | -------------: |
| Alex Morgan  | `alex.morgan@example.test`  | `Demo-Alex!2026`   |          48271 |
| Jamie Chen   | `jamie.chen@example.test`   | `Demo-Jamie!2026`  |          61504 |
| Samira Patel | `samira.patel@example.test` | `Demo-Samira!2026` |          93826 |

Start as Alex. The other two accounts are there so you can send a transfer and then
sign in as the recipient to see it arrive.

## Tests

```sh
npm test
```

This runs the unit tests plus the backend integration tests. The integration tests use
the same configured database as the app (`DATABASE_URL`, or `POSTGRES_DATABASE`), so run
`npm run db:setup` first. Tests restore demo balances and clear sessions and non-fixture
transactions before each test. Avoid using the app or running test suites concurrently.

`npm test`, `npm run test -w server`, and `npm run test:e2e` rebuild and reseed the
configured database only after their entire run succeeds. Database-backed suites stop
on the first failure and skip the final reset so the database is left for debugging.
Run `npm run db:reset` when you are ready to clear that state. The reset replaces all
data in the public schema with the demo fixtures.

The browser tests need Chromium installed once:

```sh
npx playwright install chromium
npm run test:e2e
```

## Reviewer guide

Open `/reviewer-guide`, or use the **Reviewer guide** link at the bottom left of
any page. No sign-in is required. The guide explains the architecture, security
controls, exact money representation, account lock ordering, and idempotency
recovery, with interactive examples and source-file references. It also records
the implementation’s limits and points reviewers to the relevant tests. A searchable
guide also contains the design decisions, application specification, and 62-question
engineering Q&A directly within the page.

## Other commands

| Command              | What it does                               |
| -------------------- | ------------------------------------------ |
| `npm run build`      | Build both workspaces                      |
| `npm run lint`       | Check the codebase with ESLint             |
| `npm run format`     | Format the codebase with Prettier          |
| `npm run db:migrate` | Apply pending migrations                   |
| `npm run db:seed`    | Insert any missing demo accounts           |
| `npm run db:reset`   | Rebuild and reseed the configured database |

## Layout

```text
client/                React app, routes, and session handling
server/                Express routes, security middleware, money module
database/migrations/   SQL schema
database/scripts/      Create, migrate, seed, and reset tooling
database/schema.dbml   Schema as a diagram, for reading rather than running
e2e/                   Playwright browser tests
```

Money is stored as integer minor units. A balance of 1234 means £12.34, and amounts
cross the API as strings so nothing passes through a float.

`database/schema.dbml` describes the same tables as the migration, annotated with the
constraints and the reasoning behind them. Paste it into [dbdiagram.io](https://dbdiagram.io)
for a visual of the schema. The migration is the source of truth; the diagram is a
description of it.
