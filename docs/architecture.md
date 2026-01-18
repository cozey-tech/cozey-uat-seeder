# Architecture Documentation

**Last Updated**: January 2026  
**Primary Owner**: Sam Morrison

## Purpose

This document describes the system architecture, data flows, and component relationships for the Cozey UAT Seeder. For engineering conventions and quickstart instructions, see [AGENTS.md](../AGENTS.md).

## System Overview

The UAT Seeder is a TypeScript-based command-line tool that creates coordinated test data across two systems:
1. **Shopify**: Staging orders via Admin GraphQL API
2. **WMS Database**: Warehouse entities via Prisma ORM

The tool orchestrates a complete workflow: parse configuration → validate data → seed Shopify → seed WMS → create collection prep.

## Architecture Layers

The system follows a clean architecture pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Layer (cli.ts)                    │
│  - Argument parsing, orchestration, error handling       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Handler Layer                          │
│  - Request validation (Zod schemas)                     │
│  - Error handling and propagation                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Use Case Layer                         │
│  - Business logic orchestration                         │
│  - Sequential processing, batch ID generation            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Service Layer                           │
│  - External system integrations (Shopify, WMS)           │
│  - Data validation, transformation                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Repository Layer (Prisma)                   │
│  - Database operations, transactions                     │
│  - Idempotency checks                                    │
└─────────────────────────────────────────────────────────┘
```

## Component Relationships

### CLI Orchestrator (`src/cli.ts`)

The main entry point that:
- Parses command-line arguments
- Validates staging environment
- Initializes all services and dependencies
- Orchestrates the full seeding workflow
- Provides user feedback and error handling

**Dependencies**:
- All handlers (Shopify, WMS, Collection Prep)
- Input parser and data validator
- Staging guardrails

### Handler Layer

Each handler (`*Handler.ts`) is responsible for:
- Validating incoming requests with Zod schemas
- Calling the corresponding use case
- Catching and formatting errors

**Handlers**:
- `SeedShopifyOrdersHandler`: Validates and executes Shopify order seeding
- `SeedWmsEntitiesHandler`: Validates and executes WMS entity seeding
- `CreateCollectionPrepHandler`: Validates and executes collection prep creation

### Use Case Layer

Each use case (`*UseCase.ts`) contains business logic:
- Orchestrates service calls
- Manages sequential processing
- Generates batch IDs
- Transforms data between layers

**Use Cases**:
- `SeedShopifyOrdersUseCase`: Creates draft orders → completes → fulfills → queries
- `SeedWmsEntitiesUseCase`: Creates orders → variant orders → preps → prep parts → PnP entities
- `CreateCollectionPrepUseCase`: Creates collection prep header and links preps

### Service Layer

Services handle external system integrations:

**ShopifyService** (`src/services/ShopifyService.ts`):
- GraphQL API client initialization
- Draft order creation with variant lookup
- Order completion and fulfillment
- Order querying by tags

**WmsService** (`src/services/WmsService.ts`):
- Order and customer creation (with transactions)
- Variant order creation
- Prep and prep part creation
- PnP entity creation (boxes, order boxes, prep part items)
- Shipment creation

**CollectionPrepService** (`src/services/CollectionPrepService.ts`):
- Collection prep header creation
- Order mix validation (regular-only, PnP-only, mixed)

**Supporting Services**:
- `InputParserService`: Parses and validates JSON config files
- `DataValidationService`: Validates SKUs, customers, quantities, PnP config

### Repository Layer

**WmsPrismaRepository** (`src/repositories/prisma/WmsPrismaRepository.ts`):
- Implements `WmsRepository` interface
- All database operations via Prisma Client
- Transaction support for atomicity
- Idempotency checks (find before create)

## Data Flow

### End-to-End Seeding Flow

```
1. User runs: npm run seed config.json
   │
   ├─> CLI parses arguments
   ├─> Validates staging environment
   ├─> Parses config file (InputParserService)
   ├─> Validates data (DataValidationService)
   │
2. Seed Shopify Orders
   │
   ├─> For each order in config:
   │   ├─> Create draft order (ShopifyService)
   │   ├─> Complete draft order
   │   ├─> Fulfill order
   │   └─> Query order details
   │
3. Seed WMS Entities
   │
   ├─> Create collection prep (if configured)
   │
   ├─> For each Shopify order:
   │   ├─> Create WMS order + customer (WmsService)
   │   ├─> Create variant orders
   │   ├─> Create preps
   │   ├─> Create prep parts
   │   ├─> Create PnP entities (if applicable)
   │   └─> Create shipment (if collection prep exists)
   │
4. Display summary and exit
```

### Data Transformation

**Configuration → Shopify**:
- `SeedConfig.orders[]` → `DraftOrderInput`
- Customer and line items mapped directly
- Batch ID added as tag

**Shopify → WMS**:
- `OrderQueryResult` → `SeedWmsEntitiesRequest`
- Line items mapped with quantities from config
- Customer data from config (not Shopify)

**WMS Entity Relationships**:
```
order (1) ──→ (many) variantOrder
variantOrder (1) ──→ (1) prep
prep (1) ──→ (many) prepPart
prepPart (1) ──→ (many) prepPartItem
collectionPrep (1) ──→ (many) prep
collectionPrep (1) ──→ (many) shipment
```

## Key Design Decisions

### 1. Layered Architecture with CQRS

**Rationale**: Enables isolated unit testing, clear separation of concerns, and easy extension.

**Trade-offs**:
- More boilerplate than monolithic script
- Slightly more complex for simple operations
- **Benefit**: Highly testable and maintainable

### 2. Idempotency Strategy

**Approach**: Check for existing records by unique keys before creating.

**Implementation**:
- Orders: Check by `shopifyOrderId` (unique constraint)
- Customers: Check by `email` + `region`
- Variant orders: Check by `lineItemId` (unique)
- Preps: Generated IDs, but linked to existing variant orders

**Benefit**: Safe to re-run without creating duplicates.

### 3. Staging-Only Guardrails

**Approach**: Hard-coded pattern matching on DB URL and Shopify domain.

**Patterns**:
- DB: `/staging/i`, `/stage/i`, `/test/i`, `/dev/i`, `/uat/i`
- Shopify: Same as DB, plus `/.myshopify.com$/i`

**Benefit**: Prevents accidental production execution.

### 4. Sequential Processing

**Approach**: Process orders one at a time (not in parallel).

**Rationale**: 
- Avoids Shopify API rate limits
- Easier error handling and debugging
- Clearer progress feedback

**Trade-off**: Slower than parallel processing, but acceptable for test data seeding.

### 5. Configuration-Driven

**Approach**: JSON file defines all orders, customers, line items, and collection prep config.

**Benefit**: 
- Repeatable test scenarios
- Version-controlled test data
- Easy to modify without code changes

## Error Handling Strategy

### Error Types

1. **StagingGuardrailError**: Production environment detected → Hard failure
2. **InputValidationError**: Config file parsing/validation failed → Clear error messages
3. **DataValidationError**: SKUs missing, invalid data → Lists all issues
4. **ShopifyServiceError**: API errors → Includes Shopify user errors
5. **WmsServiceError**: Database errors → Context about which operation failed

### Error Propagation

- Handlers catch and format errors
- CLI catches all errors and displays user-friendly messages
- Exit codes: 0 = success, 1 = error

### Idempotency on Errors

- If seeding fails partway, re-running will skip already-created records
- Transactions ensure atomicity for related records (order + customer)

## Database Schema Usage

The seeder uses the existing WMS Prisma schema (`prisma/schema.prisma`). Key models:

- `order`: WMS order records (linked to Shopify via `shopifyOrderId`)
- `customer`: Customer records (by email + region)
- `variantOrder`: Line item records (one per Shopify line item)
- `prep`: Prep records (one per line item)
- `prepPart`: Prep part records (parts within preps)
- `prepPartItem`: Individual items (for PnP workflows)
- `pnpBox`: Package template
- `pnpOrderBox`: Actual box for an order
- `collectionPrep`: Collection prep header
- `shipment`: Links collection prep to orders

**No schema changes required** - seeder uses existing models and relationships.

## Testing Architecture

### Unit Tests

- **Handlers**: Test request validation and error handling
- **Use Cases**: Test business logic with mocked services
- **Services**: Test external integrations with mocked clients/repositories
- **Repositories**: Test database operations (can use test database)

### Integration Tests

- **SeederIntegration.test.ts**: Full orchestration flow with mocked services
- Tests verify end-to-end data flow and component interactions

### Test Data

- JSON config files in test directory
- Mock Shopify API responses
- Test database or in-memory database for WMS operations

## Performance Considerations

1. **Sequential Processing**: Orders processed one at a time to avoid rate limits
2. **Batch Queries**: Variant lookups batched (single query for all SKUs)
3. **Transactions**: Used for atomic operations (order + customer creation)
4. **Connection Pooling**: Prisma handles database connection pooling

## Security & Safety

1. **Staging-Only**: Hard-coded guardrails prevent production execution
2. **No Secrets in Code**: All secrets via environment variables
3. **Test Emails**: Uses `@example.com` emails for Shopify orders
4. **Tagging**: All seed records tagged for easy identification and cleanup

## Future Enhancements

Potential improvements (not in current scope):

1. **Retry Logic**: Exponential backoff for transient API/database failures
2. **Dry-Run Mode**: Validate config without making API/DB calls
3. **Parallel Processing**: Process multiple orders in parallel (with rate limit handling)
4. **Resume on Failure**: Support resuming from last successful order
5. **Cleanup Command**: Remove seed records by batch ID

## Related Documents

- [AGENTS.md](../AGENTS.md): Engineering conventions and quickstart
- [Technical Design Document](../docs/technical-design-document.md): Detailed technical design and implementation decisions
- [README.md](../README.md): User-facing documentation
