# Changelog

All notable changes to the Cozey UAT Seeder will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Data model documentation (`docs/data-model.md`)
- Runbook with troubleshooting guide (`docs/runbook.md`)
- Contributing guide (`CONTRIBUTING.md`)
- Documentation inventory and classification

### Changed

- Fixed broken internal links in documentation
- Organized implementation docs (moved working notes to `ai-docs/`)
- Updated architecture.md to reference correct technical design document

### Fixed

- Fixed broken link to `docs/implementation/progress.md` (moved to `ai-docs/`)
- Fixed architecture.md link to technical design document

## [0.1.0] - 2025-01-17

### Added

- Initial release of Cozey UAT Seeder
- Shopify order seeding via Admin GraphQL API
- WMS entity seeding (orders, preps, collection preps, PnP entities)
- Collection prep creation and management
- Pick-and-pack (PnP) entity support
- Interactive config generation tool
- Staging-only guardrails
- Idempotent seeding (safe to re-run)
- Dry-run and validation modes
- AWS Secrets Manager integration
- Comprehensive test coverage

### Documentation

- README.md with quickstart and usage
- AGENTS.md with engineering conventions
- Architecture documentation
- Technical design document

---

**Note:** This is an internal tool (private repository). Version numbers are used for tracking changes and may not correspond to formal releases.
