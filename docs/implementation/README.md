# Implementation Documentation

This directory contains implementation-related documentation for the Cozey UAT Seeder.

## Contents

### `schema-alignment-audit.md`

**Purpose:** Schema alignment audit document  
**Audience:** Engineers, maintainers  
**Type:** Reference/Explanation  

This document verifies that the `SeedConfig` schema aligns with:
- Shopify Admin API requirements
- WMS database schema requirements
- Existing request/response schemas

It documents design decisions and confirms that the configuration structure correctly maps to both external systems.

**Last Updated:** 2025-01-16

## Related Documentation

- [Architecture Documentation](../architecture.md) - System architecture overview
- [Technical Design Document](../technical-design-document.md) - Detailed technical design
- [AGENTS.md](../../AGENTS.md) - Engineering conventions

## Note on Moved Files

The following files were moved to `ai-docs/` as they are AI-only working notes:
- `progress.md` - Implementation progress ledger (moved to `ai-docs/`)
- `code-review-report.md` - Code review findings (moved to `ai-docs/`)

These files remain available in `ai-docs/` for reference but are not part of the human-facing documentation.
