# AGENTS.md

Project status: active development. Core seeder functionality is implemented and tested. Documentation and tooling are established.

## 1) Purpose
- This repository will hold a TypeScript-based seeder that creates coordinated Shopify staging orders and WMS staging entities for outbound compliance testing (collection prep + pick and pack).
- Primary users: engineers and agents working on seeding and staging validation workflows.
- Good changes are safe, idempotent, staging-only, and documented.

## Instruction Precedence
1) `AGENTS.md` (this file)
2) `ai-docs/` (scope and implementation references)
3) `README.md`

## 2) Quickstart (Verified Commands Only)
- Install: `npm install`
- Build: `npm run build`
- Test: `npm run test`
- Test (watch): `npm run test:watch`
- Test (coverage): `npm run test:coverage`
- Lint: `npm run lint`
- Format: `npm run format`
- Typecheck: `npm run typecheck`
- DB/schema/migrations: `npm run prisma:generate`
- Seed: `npm run seed <config-file.json>`
- Generate config: `npm run generate-config`

## 3) Repository Map

**Source Code:**
- `src/` - Main source code
  - `business/` - Business logic (handlers, use cases)
  - `config/` - Configuration (env, staging guardrails)
  - `repositories/` - Data access layer (Prisma)
  - `services/` - External integrations (Shopify, WMS)
  - `shared/` - Shared types, enums, validation
  - `utils/` - Utilities (file reader, logger)
  - `cli.ts` - CLI entry point
  - `generateConfig.ts` - Interactive config generator

**Configuration:**
- `config/` - Configuration data files (customers, order templates)
- `prisma/` - Prisma schema and migrations
- `.env.example` - Environment variable template

**Documentation:**
- `docs/` - Human-facing documentation
- `ai-docs/` - AI-only working notes (gitignored)
- `README.md` - User-facing quickstart
- `AGENTS.md` - This file (engineering conventions)
- `CONTRIBUTING.md` - Contribution guidelines

**Scripts:**
- `scripts/` - Utility scripts

## 4) Architecture & Data
- Orchestrator job runs end-to-end: seed Shopify orders first, then seed WMS entities using those orders.
- Seed records must be tagged and safe to re-run; staging-only guardrails are required.
- Prisma is selected for ORM; schema currently lives at `prisma/schema.prisma`.
- Data model mappings documented in `docs/data-model.md`.

## 5) Engineering Conventions (Do / Don't)
- Do follow the Cozey WMS coding conventions provided by Sam (TypeScript, clear naming, enums for string comparisons, avoid deep nesting).
- Do validate all handler inputs with Zod; define per-use-case schemas and types.
- Do follow CQRS typing: distinct types for commands, queries, and responses.
- Do keep functions small and single-purpose; move large logic blocks outside `execute`.
- Do prefer declarative array methods and safe async patterns (`for...of` or `Promise.all`).
- Don't hardcode secrets; use environment variables and keep `.env` files out of git.
- Don't use async callbacks in `forEach`.

### Documentation Standards (Website Rebuild)
- Every system/feature doc follows: Purpose, Context/Dependencies, How It Works, Edge Cases, Recent Changes, Related Documents.
- Use clear H2/H3 headings, short paragraphs, tables for structured data, and minimal examples.
- Include Primary Owner + Cross Reviewer and a “Last Updated” line on docs.
- Keep docs living; update when behavior, ownership, or flows change.

## 6) Testing Strategy
- **Test Runner:** Vitest (configured in `vitest.config.ts`)
- **Test Location:** Tests live alongside source files (`*.test.ts` files)
- **Coverage:** Configured with v8 provider, thresholds: 50% lines, 60% functions, 40% branches, 50% statements
- **Test Structure:** Meaningful descriptions, `describe` grouping by feature, Arrange-Act-Assert structure
- **Run Tests:** `npm run test` (run once), `npm run test:watch` (watch mode), `npm run test:coverage` (with coverage)

## 7) Tooling & Quality Gates
- Lint: ESLint with `@cozey-tech/eslint-config` (`npm run lint`)
- Format: Prettier (`npm run format`)
- Typecheck: `tsc` (`npm run typecheck`)
- Tests: Vitest (`npm run test`)
- Coverage: Vitest with v8 provider (`npm run test:coverage`)
- Local verification checklist: lint, typecheck, test, and a smoke run of the seeder in staging-safe mode
- CI checks: To be added when CI workflows are configured

## 8) Git Workflow (Repo-Specific)
- Branch naming: `chore/*`, `feat/*`, `fix/*`, `docs/*` (see [CONTRIBUTING.md](CONTRIBUTING.md) for details)
- Commit style: Conventional Commits (see [CONTRIBUTING.md](CONTRIBUTING.md) for format)
- Keep commits atomic; avoid force-push to `main`
- See [CONTRIBUTING.md](CONTRIBUTING.md) for full workflow details

## 9) Security & Data Safety
- Seeder must refuse to run unless connected to approved staging DBs and staging Shopify store.
- Never log PII or secrets. Use test emails (e.g., `@example.com`) for Shopify orders.
- No secrets in repo; add `.env.example` when env vars are known.
- Database access must be via `DATABASE_URL` for Prisma.

## 10) Updating This File
- Update `AGENTS.md` whenever tooling, scripts, architecture, or conventions change.
- Replace TODOs with verified commands and links to source-of-truth files.

Last updated: January 2025
