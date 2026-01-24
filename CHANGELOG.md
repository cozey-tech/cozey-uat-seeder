# Changelog

All notable changes to the Cozey UAT Seeder will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Color theme with semantic colors (cyan headers, green/red/yellow/blue for status messages) for improved terminal readability (2026-01-24)
- `--no-color` flag to disable colors for CI/CD and accessibility (2026-01-24)
- Performance metrics display infrastructure showing throughput (orders/sec) and GraphQL rate limit status (2026-01-24)
- Enhanced CLI help text with organized examples, common workflows, and tips for all commands (2026-01-24)
- Timing breakdown display showing duration of each seeding phase (Shopify, WMS, Collection Prep) (2026-01-23)
- Progress bars now show estimated time remaining based on recent operation speed (2026-01-23)
- Enhanced error messages with structured "What/Why/How" format for faster issue resolution (2026-01-23)
- Data model documentation (`docs/data-model.md`)
- Runbook with troubleshooting guide (`docs/runbook.md`)
- Contributing guide (`CONTRIBUTING.md`)
- Documentation inventory and classification
- Postal code validation script (`scripts/validate-customer-postal-codes.ts`) to verify customer postal codes match carrier routing rules (2026-01-19)
- Address field validation in `ConfigDataRepository.getCustomers()` - ensures all required fields are present (2026-01-19)
- Postal code format validation - validates CA (A1A 1A1) and US (12345) formats at both schema and data load time (2026-01-19)
- Configuration file documentation (`config/README.md`) with format specifications, validation rules, and maintenance guidelines (2026-01-19)
- Manual testing checklist for staging environment verification (2026-01-19)

### Changed

- Resume config flexibility: config file is now optional when using `--resume`, with stored config path as fallback (2026-01-24)
- Warning displayed when different config specified during resume operation (2026-01-24)
- Fixed broken internal links in documentation
- Organized implementation docs (moved working notes to `ai-docs/`)
- Updated architecture.md to reference correct technical design document
- Updated customer addresses in `config/customers.json` with real, validated addresses near warehouse locations (2026-01-19)
  - All 15 customers now use public building addresses (city halls, government facilities)
  - Postal codes updated to match real address formats and validated against carrier routing rules
  - City names updated for accuracy (e.g., Royalmount customer 3: Montreal → Longueuil; Moreno customers: Los Angeles → Moreno Valley/Riverside/San Bernardino)
  - Addresses chosen to pass Shopify validation and ensure carrier compatibility
  - See `config/README.md` for complete address list and selection guidelines

### Fixed

- Fixed WMS order index mapping when processing failures during resume operations (2026-01-23)
- Fixed shipment tracking for idempotent orders during resume (2026-01-23)
- Fixed collection prep reuse when resuming operations (2026-01-23)
- Verified and fixed config order index mapping to preserve original indices (2026-01-23)
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
