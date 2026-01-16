# Cozey UAT Seeder

Seeder for Shopify staging orders and WMS staging entities to support repeatable outbound compliance testing (collection prep + pick and pack).

## Overview

This tool creates coordinated test data across two systems:
1. **Shopify**: Staging orders via Admin GraphQL API
2. **WMS Database**: Warehouse entities (orders, preps, collection preps, pick-and-pack items)

The seeder is **staging-only** and includes hard-coded guardrails to prevent execution against production environments.

## Quickstart

### Prerequisites

- Node.js (v18 or higher)
- Access to staging WMS database
- Access to staging Shopify store with Admin API credentials

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update `.env` with your staging credentials:
   - `DATABASE_URL`: PostgreSQL connection string (must match staging patterns)
   - `SHOPIFY_STORE_DOMAIN`: Shopify store domain (must match staging patterns)
   - `SHOPIFY_ACCESS_TOKEN`: Shopify Admin API access token
   - `SHOPIFY_API_VERSION`: API version (optional, defaults to 2024-01)

### Usage

1. Create a configuration file (JSON format). See [Configuration Format](#configuration-format) below.

2. Run the seeder:
   ```bash
   npm run seed <config-file.json>
   ```

   Example:
   ```bash
   npm run seed examples/seed-config.json
   ```

3. Optional flags:
   - `--validate`: Validate configuration file against schema only (no DB/API calls)
   - `--dry-run`: Simulate the full seeding flow without making actual changes
   - `--skip-confirmation`: Bypass staging confirmation prompt (not recommended)

### Validation and Dry-Run Modes

#### `--validate` Flag

Validates your configuration file against the schema without making any external API or database calls. Useful for checking config files offline.

```bash
npm run seed config.json --validate
```

**Output:**
```
✅ Configuration file validation passed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Schema: Valid
   Orders: 2
   Collection Prep: Configured
   PnP Config: Present
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Note:** `--validate` does not require a database connection or staging environment check.

#### `--dry-run` Flag

Simulates the complete seeding flow and displays what would be created, without actually creating any records in Shopify or the WMS database. Useful for previewing changes before execution.

```bash
npm run seed config.json --dry-run
```

**Output:**
```
🔍 DRY RUN MODE - No changes will be made
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 Staging Environment Check
   Database: postgresql://***@staging-db.example.com:5432/wms_staging
   Shopify: staging-store.myshopify.com
   Status: ✅ Staging

📄 Configuration: config.json
🆔 Batch ID: <generated-uuid>

🛒 Step 1: Would seed Shopify orders...
   ✅ Would create 2 Shopify order(s)

🗄️  Step 2: Would seed WMS entities...
   ✅ Would create 2 WMS order(s)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  DRY RUN - No actual changes were made
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Note:** `--dry-run` requires a database connection for SKU validation (read-only operations) and performs staging environment checks (same safety as normal run).

**Important:** The `--validate` and `--dry-run` flags are mutually exclusive and cannot be used together.

### Configuration Format

Example `seed-config.json`:

```json
{
  "collectionPrep": {
    "carrier": "FedEx",
    "locationId": "WH1",
    "region": "CA",
    "prepDate": "2026-01-20T10:00:00Z"
  },
  "orders": [
    {
      "orderType": "regular-only",
      "customer": {
        "name": "Test Customer",
        "email": "test@example.com"
      },
      "lineItems": [
        {
          "sku": "SOFA-CHAR-BLK",
          "quantity": 1,
          "pickType": "Regular"
        }
      ]
    },
    {
      "orderType": "pnp-only",
      "customer": {
        "name": "Test Customer 2",
        "email": "test2@example.com"
      },
      "lineItems": [
        {
          "sku": "PILLOW-STD-WHT",
          "quantity": 2,
          "pickType": "Pick and Pack",
          "hasBarcode": true
        }
      ]
    }
  ],
  "pnpConfig": {
    "packageInfo": [
      {
        "identifier": "SMALL_BOX",
        "dimensions": { "length": 12, "width": 8, "height": 6 },
        "weight": 2.5
      }
    ],
    "boxes": [
      {
        "identifier": "SMALL_BOX",
        "dimensions": { "length": 12, "width": 8, "height": 6 }
      }
    ]
  }
}
```

## Development

### Available Scripts

- `npm run build`: Compile TypeScript
- `npm run test`: Run tests
- `npm run lint`: Lint code
- `npm run format`: Format code with Prettier
- `npm run typecheck`: Type check without emitting files
- `npm run seed <config-file.json>`: Run the seeder

### Project Structure

```
src/
├── business/          # Business logic (handlers, use cases)
├── config/            # Configuration (env, staging guardrails)
├── repositories/      # Data access layer (Prisma)
├── services/          # External integrations (Shopify, WMS)
├── shared/            # Shared types, enums, validation
├── utils/             # Utilities (file reader, logger)
└── cli.ts             # CLI entry point
```

## Documentation

- [Architecture Documentation](docs/architecture.md): System architecture and design decisions
- [AGENTS.md](AGENTS.md): Engineering conventions and development guidelines
- [Implementation Progress](docs/implementation/progress.md): Current implementation status

## Safety Features

- **Staging-Only**: Hard-coded guardrails prevent production execution
- **Idempotent**: Safe to re-run without creating duplicates
- **Tagging**: All seed records tagged with batch IDs for easy cleanup
- **Validation**: Comprehensive validation of SKUs, customers, and configuration
- **Dry-Run Mode**: Preview changes before execution with `--dry-run` flag
- **Offline Validation**: Validate config files without database connection using `--validate` flag

## Troubleshooting

### "Staging Guardrail Violation" Error

The tool detected a production environment. Check:
- `DATABASE_URL` contains staging patterns (staging, stage, test, dev, uat)
- `SHOPIFY_STORE_DOMAIN` contains staging patterns or ends with `.myshopify.com`

### "Missing SKUs in WMS" Error

The configuration references SKUs that don't exist in the WMS database. Verify:
- SKUs are correct and exist in the staging WMS database
- Region matches the database region

### "Configuration file validation failed" Error

The JSON configuration file doesn't match the expected schema. Check:
- JSON syntax is valid
- All required fields are present
- Field types match (e.g., quantities are numbers, not strings)

## License

Private - Internal Cozey tool
