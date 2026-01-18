# Cozey UAT Seeder

Seeder for Shopify staging orders and WMS staging entities to support repeatable outbound compliance testing (collection prep + pick and pack).

## Overview

This tool creates coordinated test data across two systems:
1. **Shopify**: Staging orders via Admin GraphQL API
2. **WMS Database**: Warehouse entities (orders, preps, collection preps, pick-and-pack items)

The seeder is **staging-only** and includes hard-coded guardrails to prevent execution against production environments.

## Quickstart

### Prerequisites

- Node.js 20.13.0 (use nvm to manage versions - see below)
- Access to staging WMS database
- Access to staging Shopify store with Admin API credentials

#### Node Version Management

This project requires Node.js 20.13.0. We recommend using [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) to manage Node versions.

**Install nvm** (if not already installed):
```bash
# macOS/Linux
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Or using Homebrew on macOS
brew install nvm
```

**Use the correct Node version:**
```bash
# Install Node 20.13.0 (if not already installed)
nvm install 20.13.0

# Use Node 20.13.0 for this project
nvm use

# Or set it as default
nvm alias default 20.13.0
```

The project includes an `.nvmrc` file, so running `nvm use` in the project directory will automatically switch to the correct version.

### Installation

```bash
npm install
```

### Configuration

The seeder supports two methods for loading configuration:

#### Option 1: AWS Secrets Manager (Recommended for AWS environments)

By default, the seeder attempts to fetch secrets from AWS Secrets Manager with automatic fallback to `.env` files. This is ideal when running in AWS environments (EC2, ECS, Lambda, etc.).

**AWS Secrets:**
- `dev/uat-database-url`: Contains `DATABASE_URL`
- `dev/shopify-access-token`: Contains `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_STORE_DOMAIN`, and optionally `SHOPIFY_API_VERSION`

**Configuration options:**
- `USE_AWS_SECRETS`: Enable/disable AWS secrets (default: `true`)
- `AWS_REGION`: AWS region (default: `us-east-1`). **Important:** Check your secret ARNs in AWS Secrets Manager to determine the correct region (e.g., if ARN contains `us-east-2`, set `AWS_REGION=us-east-2`)
- `AWS_PROFILE`: AWS profile name from `~/.aws/credentials` (optional, defaults to "default" profile)
- `AWS_DATABASE_SECRET_NAME`: Custom database secret name (default: `dev/uat-database-url`)
- `AWS_SHOPIFY_SECRET_NAME`: Custom Shopify secret name (default: `dev/shopify-access-token`)

**AWS Credentials:** The seeder automatically detects AWS credentials from:
1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. AWS IAM role (when running in AWS)
3. AWS credentials file (`~/.aws/credentials`) - specify profile via `AWS_PROFILE`
4. Default credential provider chain

**Multiple AWS Profiles:** If you have multiple profiles in `~/.aws/credentials`, set `AWS_PROFILE` to select which profile to use:
```bash
# Use the "dev" profile from ~/.aws/credentials
AWS_PROFILE=dev npm run seed config.json
```

#### Option 2: Environment Variables (.env files)

For local development or when AWS is unavailable, use `.env` files:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update `.env` with your staging credentials:
   - `DATABASE_URL`: PostgreSQL connection string (must match staging patterns)
   - `SHOPIFY_STORE_DOMAIN`: Shopify store domain (must match staging patterns)
   - `SHOPIFY_ACCESS_TOKEN`: Shopify Admin API access token
   - `SHOPIFY_API_VERSION`: API version (optional, defaults to 2024-01)

**Hybrid Mode:** The seeder merges values from both sources - AWS secrets override `.env` values, but missing AWS values fallback to `.env`. This provides flexibility and resilience.

**Disable AWS Secrets:** Set `USE_AWS_SECRETS=false` in your `.env` file to use environment variables only.

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
- [Technical Design Document](docs/technical-design-document.md): Detailed technical design and implementation decisions
- [Data Model Documentation](docs/data-model.md): Database schema, relationships, and entity details
- [Runbook](docs/runbook.md): Operations guide, troubleshooting, and incident playbooks
- [Contributing Guide](CONTRIBUTING.md): How to contribute to this project

## Safety Features

- **Staging-Only**: Hard-coded guardrails prevent production execution
- **Idempotent**: Safe to re-run without creating duplicates
- **Tagging**: All seed records tagged with batch IDs for easy cleanup
- **Validation**: Comprehensive validation of SKUs, customers, and configuration
- **Dry-Run Mode**: Preview changes before execution with `--dry-run` flag
- **Offline Validation**: Validate config files without database connection using `--validate` flag

## Troubleshooting

### "Environment configuration not initialized" Error

This error occurs if `getEnvConfig()` is called before `initializeEnvConfig()`. This should not happen in normal usage, but if you're writing custom code, ensure you call `initializeEnvConfig()` first.

### "Staging Guardrail Violation" Error

The tool detected a production environment. Check:
- `DATABASE_URL` contains staging patterns (staging, stage, test, dev, uat)
- `SHOPIFY_STORE_DOMAIN` contains staging patterns or ends with `.myshopify.com`

### AWS Secrets Manager Issues

If you're experiencing issues with AWS Secrets Manager:

1. **"Failed to fetch secret from AWS" warnings:**
   - Verify AWS credentials are configured correctly
   - Check that the secret names match your AWS Secrets Manager secrets
   - Ensure your IAM role/user has `secretsmanager:GetSecretValue` permission
   - The seeder will automatically fallback to `.env` files, so this is non-fatal

2. **"AWS credentials error" or expired credentials:**
   - If using temporary credentials (STS), they may have expired - refresh them
   - If using `~/.aws/credentials`, verify the credentials are valid and not expired
   - Check that `AWS_PROFILE` matches a valid profile in `~/.aws/credentials`
   - For IAM roles, ensure the role session hasn't expired

3. **Multiple AWS profiles:**
   - If you have multiple profiles in `~/.aws/credentials`, set `AWS_PROFILE` to select which one to use
   - Example: `AWS_PROFILE=dev` to use the `[dev]` profile
   - If `AWS_PROFILE` is not set, the `[default]` profile will be used

4. **To disable AWS secrets entirely:**
   - Set `USE_AWS_SECRETS=false` in your `.env` file
   - The seeder will use `.env` files only

5. **Custom secret names:**
   - Set `AWS_DATABASE_SECRET_NAME` and `AWS_SHOPIFY_SECRET_NAME` in `.env`
   - Defaults: `dev/uat-database-url` and `dev/shopify-access-token`

6. **Wrong AWS region:**
   - Set `AWS_REGION` in `.env` (default: `us-east-1`)

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
