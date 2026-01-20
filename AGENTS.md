# AGENTS.md

Project status: active development. Core seeder functionality is implemented and tested. Documentation and tooling are established.

## Changelog

**2025-01-17:** Added section 3.5 "AI-Generated Documents & Agent Reference Information" with universal rule requiring all AI-generated reports to be saved to `ai-docs/` folder with plan name prefixes. This ensures proper separation between human-facing documentation (`docs/`) and AI-generated working notes (`ai-docs/`).

## 1) Purpose

- This repository will hold a TypeScript-based seeder that creates coordinated Shopify staging orders and WMS staging entities for outbound compliance testing (collection prep + pick and pack).
- Primary users: engineers and agents working on seeding and staging validation workflows.
- Good changes are safe, idempotent, staging-only, and documented.

## Instruction Precedence

1. `AGENTS.md` (this file)
2. `ai-docs/` (scope and implementation references)
3. `README.md`

## 2) Quickstart (Verified Commands Only)

- Install: `npm install`
- Build: `npm run build`
- Test: `npm run test`
- Test (watch): `npm run test:watch`
- Test (coverage): `npm run test:coverage`
- Lint: `npm run lint`
- Lint (fix): `npm run lint:fix`
- Format: `npm run format`
- Format (check): `npm run format:check`
- Typecheck: `npm run typecheck`
- DB/schema/migrations: `npm run prisma:generate`
- Seed: `npm run seed <config-file.json>`
- Generate config: `npm run generate-config`
- Cleanup: `npm run cleanup -- --batch-id <id>` Delete test data by batch ID
- Fetch order template: `npm run fetch-order-template -- <order-number> [--save]` Convert Shopify order to template
- Fetch multiple templates: `npm run fetch-order-templates-batch -- <order-numbers...> [--save]` Batch convert orders

## 3) Repository Map

**Source Code:**

- `src/` - Main source code
- `business/` - Business logic (handlers, use cases)
  - `cleanup/` - Cleanup feature (handlers, use cases)
- `cli/` - CLI modules (args, validation, orchestration, output)
  - `cleanupArgs.ts` - Cleanup argument parsing
  - `cleanupOrchestration.ts` - Cleanup flow orchestration
- `config/` - Configuration (env, staging guardrails)
- `repositories/` - Data access layer (Prisma)
- `services/` - External integrations (Shopify, WMS)
  - `WmsCleanupService.ts` - WMS cleanup coordination
- `shared/` - Shared types, enums, validation
- `utils/` - Utilities (file reader, logger)
- `cli.ts` - Seeding CLI entry point
- `cleanup.ts` - Cleanup CLI entry point
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

## 3.5) AI-Generated Documents & Agent Reference Information

**Universal Rule:** ALL AI-generated project files MUST be saved to the `ai-docs/` folder in the project root.

**Documentation Separation:**

- `docs/` → Human-facing documentation (for engineers, users, stakeholders)
- `ai-docs/` → AI-generated files + AI reference information (gitignored, not in codebase)

**Purpose of `ai-docs/`:**

1. **AI-generated reports, review documents, and transient working notes** - All reports from review commands, audit commands, and analysis tools
2. **Agent reference information** - Helpful information for AI agents to read and review that shouldn't be in the codebase

**Naming Convention:**

- Format: `{PLAN_NAME}_{TYPE}_REPORT.md` (e.g., `ai-docs-report-routing_CODE_REVIEW_REPORT.md`)
- **Plan name is REQUIRED** in all report filenames to avoid conflicts when working on multiple plans
- Plan name detection method:
  1. Extract from current plan file path (remove `.plan.md` extension and hash suffix)
     - Example: `ai-docs-report-routing_a9514947.plan.md` → `ai-docs-report-routing`
  2. If plan file not available, fallback to project name from `package.json` `name` field
  3. If `package.json` not available, use git repo basename: `git rev-parse --show-toplevel | xargs basename`
- Report type: UPPERCASE with underscores (e.g., `CODE_REVIEW`, `PLAN_REVIEW`, `SECURITY_SWEEP`)
- Include date/timestamp in filename if multiple versions are needed (e.g., `ai-docs-report-routing_CODE_REVIEW_REPORT_2025-01-17.md`)

**Never save AI-generated files to:**

- Repo root (except `AGENTS.md`)
- `docs/` folder (reserved for human-facing documentation)
- Any location that would be committed to git

**If `ai-docs/` doesn't exist, create it first** before saving any reports.

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

### Cleanup Operations

- Do use transactions for WMS entity deletions (atomicity).
- Do validate tags before cleanup (only test tags allowed: wms_seed, seed_batch_id, collection_prep).
- Do implement continue-on-error pattern (collect failures, don't abort).
- Do use hybrid cleanup for Shopify (delete manual payment orders, archive online gateway orders).
- Don't delete collection preps if still referenced by other batches (safety check required).
- Don't bypass staging guardrails (cleanup is staging-only).

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

- Lint: ESLint with `@cozey-tech/eslint-config` (`npm run lint`, `npm run lint:fix`)
- Format: Prettier (`npm run format`, `npm run format:check`)
- Typecheck: `tsc` (`npm run typecheck`)
- Tests: Vitest (`npm run test`, `npm run test:watch`, `npm run test:coverage`)
- Coverage: Vitest with v8 provider, thresholds: 50% lines, 60% functions, 40% branches, 50% statements
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

Last updated: January 2025 (2025-01-17: Added AI-Generated Documents section)
