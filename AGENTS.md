# AGENTS.md

Project status: bootstrapping. This repo currently only contains scope documentation; commands and tooling are not yet defined.

## 1) Purpose
- This repository will hold a TypeScript-based seeder that creates coordinated Shopify staging orders and WMS staging entities for outbound compliance testing (collection prep + pick and pack).
- Primary users: engineers and agents working on seeding and staging validation workflows.
- Good changes are safe, idempotent, staging-only, and documented.

## Instruction Precedence
1) `AGENTS.md` (this file)
2) `ai-docs/` (scope and implementation references)
3) `README.md`

## 2) Quickstart (Verified Commands Only)
- Install: TODO — add package manager and install command once `package.json` exists.
- Run dev: TODO — add script after initial seeder entrypoint is created.
- Build: TODO — add build script after tooling is added.
- Test: TODO — add test runner and scripts.
- Lint/format: TODO — add ESLint/Prettier (likely `@cozey-tech/eslint-config`) and scripts.
- Typecheck: TODO — add `tsc` or equivalent once `tsconfig.json` exists.
- DB/schema/migrations: TODO — confirm ORM and add commands if applicable.

## 3) Repository Map
- TODO — define directories once code is added (expected: `src/`, `scripts/`, `prisma/` or `db/`).

## 4) Architecture & Data
- Orchestrator job runs end-to-end: seed Shopify orders first, then seed WMS entities using those orders.
- Seed records must be tagged and safe to re-run; staging-only guardrails are required.
- TODO — confirm ORM and schema location (likely Prisma) and document data model mappings.

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
- TODO — decide test runner (Vitest/Jest) and where tests live.
- Expectations once tests exist: meaningful descriptions, `describe` grouping by feature, and Arrange-Act-Assert structure.

## 7) Tooling & Quality Gates
- TODO — define lint/format/typecheck scripts and CI checks once tooling exists.
- Local verification checklist should include: lint, typecheck, test, and a smoke run of the seeder in staging-safe mode.

## 8) Git Workflow (Repo-Specific)
- Branch naming: `chore/*`, `feat/*`, `fix/*` (adjust if a different convention is adopted).
- Commit style: prefer Conventional Commits (confirm once team standard is defined).
- Keep commits atomic; avoid force-push to `main`.

## 9) Security & Data Safety
- Seeder must refuse to run unless connected to approved staging DBs and staging Shopify store.
- Never log PII or secrets. Use test emails (e.g., `@example.com`) for Shopify orders.
- No secrets in repo; add `.env.example` when env vars are known.

## 10) Updating This File
- Update `AGENTS.md` whenever tooling, scripts, architecture, or conventions change.
- Replace TODOs with verified commands and links to source-of-truth files.

Last updated: January 2026 (AI)
