# Technical Design Document: Cozey UAT Seeder

## 📌 Project Title

Cozey UAT Seeder - Staging Order and WMS Entity Seeding Tool

## 👥 Project Champion & Team Members

- **Project Champion**: Sam Morrison
- **Team Members**: Sam Morrison (sole contributor)

## 📎 Project Setup & Reference Materials

- **PRD**: N/A (Internal testing tool)
- **Figma Designs**: N/A (Internal testing tool)
- **Repository**: `cozey-uat-seeder`
- **Architecture Documentation**: `docs/architecture.md`
- **Agent Instructions**: `AGENTS.md` (engineering conventions and quickstart)
- **Implementation Progress**: `docs/implementation/progress.md`

---

## 1. 🎯 Problem Statement

The WMS (Warehouse Management System) testing workflow requires coordinated test data across two systems:

1. **Shopify**: Staging orders that represent customer purchases
2. **WMS Database**: Warehouse entities (orders, preps, collection preps, pick-and-pack items) that mirror those Shopify orders

Currently, creating test data for collection prep and pick-and-pack workflows is manual, time-consuming, and error-prone. Engineers need to:

- Manually create Shopify draft orders
- Manually create corresponding WMS entities
- Repeat this process for different test scenarios

**Business Objective**: Enable repeatable, automated seeding of coordinated test data to accelerate outbound compliance testing cycles and reduce manual setup time.

**KPI**: Reduce test data setup time from hours to minutes, enabling faster iteration on compliance testing workflows.

---

## 2. 🧭 Goals & Non-Goals

### Goals

1. **Automated Coordination**: Create Shopify orders and corresponding WMS entities in a single orchestrated run
2. **Idempotency**: Safe to re-run without creating duplicate records
3. **Staging Safety**: Hard-coded guardrails prevent execution against production environments
4. **Flexible Configuration**: Support various order types (regular-only, PnP-only, mixed) via JSON configuration
5. **Collection Prep Support**: Create collection prep entities that group 3-5 orders for testing collection workflows
6. **Tagging & Cleanup**: All seed records tagged with batch IDs for easy identification and cleanup
7. **Type Safety**: Full TypeScript implementation with Zod validation

### Non-Goals (Out of Scope)

1. **Production Environment Support**: This tool is staging-only
2. **Order Cancellation/Modification**: Only creates orders; does not modify or cancel existing orders
3. **Payment Processing**: Uses draft orders that don't require payment
4. **Inventory Management**: Does not manage inventory levels or stock
5. **UI/Web Interface**: Command-line tool only
6. **Real-time Monitoring**: No dashboard or monitoring interface
7. **Multi-region Orchestration**: Single region per run (CA or US)
8. **Retry Logic for Transient Failures**: Deferred to future enhancement. Current implementation relies on sequential processing and clear error messages. Retry logic can be added if needed based on observed failure patterns.

---

## 3. 🔍 Proposed Approaches

### Option A: Monolithic Script with Direct API Calls

**Description**: Single TypeScript script that directly calls Shopify Admin API and WMS database via Prisma, with minimal abstraction.

**Pros**:

- Simple to understand and maintain
- Fast to implement
- Minimal dependencies

**Cons**:

- Difficult to test individual components
- Tight coupling between orchestration and implementation
- Hard to extend with new features
- No separation of concerns

### Option B: Layered Architecture with CQRS Pattern (✅ Chosen)

**Description**: Clean architecture with separation of concerns:

- **Handlers**: Request validation and error handling
- **Use Cases**: Business logic orchestration
- **Services**: External system integrations (Shopify, WMS)
- **Repositories**: Data access abstraction
- **Shared Types**: CQRS request/response types with Zod validation

**Pros**:

- Highly testable (unit tests for each layer)
- Clear separation of concerns
- Easy to extend with new features
- Follows Cozey WMS coding conventions
- Type-safe with comprehensive validation
- Idempotent operations built-in

**Cons**:

- More initial setup and boilerplate
- Slightly more complex for simple operations

### ✅ Chosen Approach & Rationale

**Option B (Layered Architecture with CQRS)** was selected because:

1. **Testability**: The project requires comprehensive test coverage (44 tests across 9 files currently). The layered architecture enables isolated unit testing of each component.

2. **Maintainability**: As an internal tool that may need to evolve (new order types, new WMS entities), the clean architecture makes changes safer and easier.

3. **Code Quality Standards**: Aligns with Cozey WMS conventions (TypeScript, clear naming, enums, avoid deep nesting) as specified in `AGENTS.md`.

4. **Safety First**: The staging-only requirement demands robust validation and error handling, which the layered approach provides through handler-level validation and service-level error boundaries.

5. **Idempotency**: Repository pattern enables easy checks for existing records, making re-runs safe.

---

## 4. 🏗️ System Design & Architecture

### High-Level Architecture Diagram

```mermaid
graph TB
    subgraph Input["Input Layer"]
        ConfigFile[JSON Config File]
    end
    
    subgraph Orchestrator["Orchestrator"]
        MainEntry[Main Entry Point<br/>cli.ts]
    end
    
    subgraph Handlers["Handler Layer"]
        ShopifyHandler[SeedShopifyOrdersHandler]
        WmsHandler[SeedWmsEntitiesHandler]
        CollectionPrepHandler[CreateCollectionPrepHandler]
    end
    
    subgraph UseCases["Use Case Layer"]
        ShopifyUC[SeedShopifyOrdersUseCase]
        WmsUC[SeedWmsEntitiesUseCase]
        CollectionPrepUC[CreateCollectionPrepUseCase]
    end
    
    subgraph Services["Service Layer"]
        ShopifySvc[ShopifyService]
        WmsSvc[WmsService]
        CollectionPrepSvc[CollectionPrepService]
        ValidationSvc[DataValidationService]
        ParserSvc[InputParserService]
    end
    
    subgraph Repositories["Repository Layer"]
        WmsRepo[WmsPrismaRepository]
    end
    
    subgraph External["External Systems"]
        ShopifyAPI[Shopify Admin API]
        WmsDB[(WMS PostgreSQL DB)]
    end
    
    ConfigFile --> MainEntry
    MainEntry --> ShopifyHandler
    MainEntry --> WmsHandler
    MainEntry --> CollectionPrepHandler
    
    ShopifyHandler --> ShopifyUC
    WmsHandler --> WmsUC
    CollectionPrepHandler --> CollectionPrepUC
    
    ShopifyUC --> ShopifySvc
    WmsUC --> WmsSvc
    WmsUC --> CollectionPrepSvc
    CollectionPrepUC --> CollectionPrepSvc
    
    ShopifySvc --> ShopifyAPI
    WmsSvc --> WmsRepo
    CollectionPrepSvc --> WmsRepo
    WmsRepo --> WmsDB
    
    MainEntry --> ValidationSvc
    MainEntry --> ParserSvc
```

### Sequence Diagram: End-to-End Seeding Flow

```mermaid
sequenceDiagram
    participant User
    participant Main as Main Entry Point
    participant Parser as InputParserService
    participant Validator as DataValidationService
    participant ShopifyHandler as SeedShopifyOrdersHandler
    participant ShopifyUC as SeedShopifyOrdersUseCase
    participant ShopifySvc as ShopifyService
    participant ShopifyAPI as Shopify Admin API
    participant WmsHandler as SeedWmsEntitiesHandler
    participant WmsUC as SeedWmsEntitiesUseCase
    participant WmsSvc as WmsService
    participant WmsRepo as WmsPrismaRepository
    participant DB as WMS Database
    participant CollectionPrepHandler as CreateCollectionPrepHandler
    participant CollectionPrepUC as CreateCollectionPrepUseCase
    participant CollectionPrepSvc as CollectionPrepService

    User->>Main: Run seeder with config file
    Main->>Main: Assert staging environment
    Main->>Parser: Parse JSON config file
    Parser-->>Main: Validated SeedConfig
    Main->>Validator: Validate SKUs, customers, quantities
    Validator-->>Main: Validation passed
    
    Main->>ShopifyHandler: Execute seedShopifyOrders
    ShopifyHandler->>ShopifyUC: Execute with request
    loop For each order in config
        ShopifyUC->>ShopifySvc: Create draft order
        ShopifySvc->>ShopifyAPI: GraphQL mutation
        ShopifyAPI-->>ShopifySvc: Draft order ID
        ShopifyUC->>ShopifySvc: Complete draft order
        ShopifySvc->>ShopifyAPI: GraphQL mutation
        ShopifyAPI-->>ShopifySvc: Order ID & number
        ShopifyUC->>ShopifySvc: Fulfill order
        ShopifySvc->>ShopifyAPI: GraphQL mutation
        ShopifyAPI-->>ShopifySvc: Fulfillment status
    end
    ShopifyUC->>ShopifySvc: Query created orders by tag
    ShopifySvc->>ShopifyAPI: GraphQL query
    ShopifyAPI-->>ShopifySvc: Order details with line items
    ShopifyUC-->>ShopifyHandler: Response with order IDs
    ShopifyHandler-->>Main: Shopify seeding complete
    
    Main->>WmsHandler: Execute seedWmsEntities
    WmsHandler->>WmsUC: Execute with Shopify orders
    loop For each Shopify order
        WmsUC->>WmsSvc: Create order with customer
        WmsSvc->>WmsRepo: Find existing order (idempotency)
        alt Order exists
            WmsRepo-->>WmsSvc: Existing order
        else Order doesn't exist
            WmsSvc->>WmsRepo: Create order & customer
            WmsRepo->>DB: INSERT transaction
            DB-->>WmsRepo: Order & customer IDs
        end
        WmsUC->>WmsSvc: Create variant orders
        WmsSvc->>WmsRepo: Find variants by SKUs
        WmsRepo->>DB: SELECT variants
        DB-->>WmsRepo: Variant data
        WmsSvc->>WmsRepo: Create variant orders
        WmsRepo->>DB: INSERT variant orders
        WmsUC->>WmsSvc: Create preps
        WmsSvc->>WmsRepo: Create preps & prep parts
        WmsRepo->>DB: INSERT preps, prep parts
        WmsUC->>WmsSvc: Create PnP entities (if applicable)
        WmsSvc->>WmsRepo: Create PnP boxes, order boxes, prep part items
        WmsRepo->>DB: INSERT PnP entities
    end
    WmsUC-->>WmsHandler: Response with created entities
    WmsHandler-->>Main: WMS seeding complete
    
    alt Collection prep configured
        Main->>CollectionPrepHandler: Execute createCollectionPrep
        CollectionPrepHandler->>CollectionPrepUC: Execute with order IDs
        CollectionPrepUC->>CollectionPrepSvc: Validate order mix
        CollectionPrepSvc-->>CollectionPrepUC: Validation passed
        CollectionPrepUC->>CollectionPrepSvc: Create collection prep
        CollectionPrepSvc->>WmsRepo: Create collection prep
        WmsRepo->>DB: INSERT collection prep
        WmsRepo->>DB: UPDATE preps with collection prep ID
        CollectionPrepUC-->>CollectionPrepHandler: Collection prep ID
        CollectionPrepHandler-->>Main: Collection prep created
    end
    
    Main-->>User: Seeding complete with summary
```

### Data Flow

```mermaid
flowchart LR
    subgraph Input["Input Data"]
        JSON[JSON Config File]
    end
    
    subgraph Validation["Validation Layer"]
        ZodSchema[Zod Schema Validation]
        BusinessRules[Business Rule Validation]
    end
    
    subgraph Transformation["Data Transformation"]
        ShopifyFormat[Shopify Order Format]
        WmsFormat[WMS Entity Format]
    end
    
    subgraph Persistence["Persistence"]
        ShopifyAPI[(Shopify Orders)]
        WmsDB[(WMS Database)]
    end
    
    JSON --> ZodSchema
    ZodSchema --> BusinessRules
    BusinessRules --> ShopifyFormat
    BusinessRules --> WmsFormat
    ShopifyFormat --> ShopifyAPI
    WmsFormat --> WmsDB
    ShopifyAPI -.Query.-> WmsFormat
```

### Dependencies / Integrations

1. **Shopify Admin API** (GraphQL)
   - Authentication: Access token via environment variable
   - API Version: 2024-01 (configurable)
   - Operations: Draft order creation, order completion, fulfillment, order querying

2. **WMS PostgreSQL Database**
   - ORM: Prisma Client
   - Connection: `DATABASE_URL` environment variable
   - Schema: Full WMS schema (orders, customers, preps, collection preps, PnP entities)

3. **Node.js Runtime**
   - TypeScript compilation
   - Environment variable management (dotenv)

4. **External Libraries**:
   - `@shopify/admin-api-client`: Shopify API client
   - `@prisma/client`: Database ORM
   - `zod`: Runtime validation
   - `uuid`: ID generation
   - `inquirer`: Interactive CLI prompts (for staging confirmation)
   - `tsx`: TypeScript execution for CLI

---

## 5. 🛠️ Implementation Details

### 5.1 Configuration & Input Parsing

**Backend**

- **InputParserService** (`src/services/InputParserService.ts`)
  - Parses JSON configuration files
  - Validates against `seedConfigSchema` (Zod)
  - Returns typed `SeedConfig` object
  - Error handling for file I/O and JSON parsing

- **DataValidationService** (`src/services/DataValidationService.ts`)
  - Validates SKUs exist in WMS database
  - Validates customer data format
  - Validates quantities are positive integers
  - Validates PnP configuration (if provided)
  - Validates order type declarations match line item pick types

- **Environment Configuration** (`src/config/env.ts`)
  - Validates required environment variables with Zod
  - `DATABASE_URL`: PostgreSQL connection string
  - `SHOPIFY_STORE_DOMAIN`: Shopify store domain
  - `SHOPIFY_ACCESS_TOKEN`: Shopify API access token
  - `SHOPIFY_API_VERSION`: API version (default: "2024-01")

**Database**

- No schema changes required for configuration layer
- Uses existing WMS schema for validation queries (variants, parts)

**Error Handling**

- `InputValidationError`: Thrown when JSON parsing or Zod validation fails
- Clear error messages indicating which field failed validation
- File not found errors handled gracefully

---

### 5.2 Staging Safety & Guardrails

**Backend**

- **StagingGuardrails** (`src/config/stagingGuardrails.ts`)
  - `assertStagingEnvironment()`: Validates DB URL and Shopify domain match staging patterns
  - Staging DB patterns: `/staging/i`, `/stage/i`, `/test/i`, `/dev/i`, `/uat/i`
  - Staging Shopify patterns: Same as DB, plus `/.myshopify.com$/i`
  - `displayStagingEnvironment()`: Returns masked environment info for confirmation
  - `requireExplicitStagingConfirmation()`: Validates environment before execution

- **StagingGuardrailError** (`src/shared/errors/StagingGuardrailError.ts`)
  - Custom error type for guardrail violations
  - Prevents execution if environment doesn't match staging patterns

**Infra & DevOps**

- Environment variables must be set in `.env` file (not committed to git)
- `.env.example` documents required variables
- No secrets in codebase

**Error Handling**

- Hard failure if production environment detected
- URL masking in error messages (passwords hidden)
- Clear error messages explaining why execution was blocked

---

### 5.3 Shopify Order Seeding

**Backend**

- **ShopifyService** (`src/services/ShopifyService.ts`)
  - Initializes Shopify Admin API client
  - `createDraftOrder()`: Creates draft order with customer and line items
    - Looks up variant IDs by SKU using GraphQL query
    - Tags draft order with batch ID (`wms_seed_<batchId>`)
    - Adds note indicating it's a WMS seed order
  - `completeDraftOrder()`: Converts draft order to regular order
    - Returns order ID and order number
  - `fulfillOrder()`: Creates fulfillment without payment requirement
    - Required for orders to appear in WMS workflows
  - `queryOrdersByTag()`: Retrieves created orders by batch tag
    - Returns order IDs, numbers, and line items with SKUs

- **SeedShopifyOrdersUseCase** (`src/business/seedShopifyOrders/SeedShopifyOrdersUseCase.ts`)
  - Orchestrates order creation flow
  - Processes orders sequentially (to avoid rate limits)
  - Generates unique batch ID per run
  - Returns created order details for WMS seeding phase

- **SeedShopifyOrdersHandler** (`src/business/seedShopifyOrders/SeedShopifyOrdersHandler.ts`)
  - Validates request with `seedShopifyOrdersRequestSchema` (Zod)
  - Calls use case
  - Handles `ShopifyServiceError` and propagates with context

**API Endpoints**

- Shopify Admin GraphQL API:
  - `draftOrderCreate` mutation
  - `draftOrderComplete` mutation
  - `fulfillmentCreate` mutation
  - `orders` query (filtered by tags)

**Error Handling**

- `ShopifyServiceError`: Custom error with user errors from Shopify API
- Retry strategy: Not currently implemented (could be added for transient failures)
- Rate limiting: Sequential processing helps avoid rate limits
- Variant lookup failures: Clear error message indicating which SKU was not found

---

### 5.4 WMS Entity Seeding

**Backend**

- **WmsService** (`src/services/WmsService.ts`)
  - `createOrderWithCustomer()`: Creates WMS order and customer
    - Idempotent: Checks for existing order by Shopify order ID
    - Creates customer if doesn't exist (by email)
    - Uses transaction for atomicity
  - `createVariantOrdersForOrder()`: Creates variant order records
    - Batch looks up variants by SKUs
    - Creates variant order for each line item
    - Links to order via `orderId` (Shopify order ID)
  - `createPrepsForOrder()`: Creates prep records
    - One prep per line item
    - Links to variant order via `lineItemId`
    - Sets fulfillment status to "Open"
  - `createPrepPartsForPrep()`: Creates prep part records
    - Looks up parts by SKU and variant
    - Creates prep part with quantity from line item
  - `createPnpEntitiesForOrder()`: Creates PnP-specific entities
    - Creates `pnpBox` records (package templates)
    - Creates `pnpOrderBox` records (actual boxes for order)
    - Creates `prepPartItem` records (individual items in boxes)
    - Links items to boxes via `pnpOrderBoxId`

- **WmsPrismaRepository** (`src/repositories/prisma/WmsPrismaRepository.ts`)
  - Implements `WmsRepository` interface
  - All database operations via Prisma Client
  - Transaction support for atomic operations
  - Idempotency checks (find by unique keys before create)

- **SeedWmsEntitiesUseCase** (`src/business/seedWmsEntities/SeedWmsEntitiesUseCase.ts`)
  - Orchestrates WMS entity creation
  - Processes orders sequentially
  - Creates orders → variant orders → preps → prep parts → PnP entities
  - Returns summary of created entities

- **SeedWmsEntitiesHandler** (`src/business/seedWmsEntities/SeedWmsEntitiesHandler.ts`)
  - Validates request with `seedWmsEntitiesRequestSchema` (Zod)
  - Calls use case
  - Handles `WmsServiceError` and database errors

**Database**

- **Schema**: Uses existing WMS Prisma schema (`prisma/schema.prisma`)
- **Key Models Used**:
  - `order`: WMS order records
  - `customer`: Customer records
  - `variantOrder`: Line item records
  - `prep`: Prep records (one per line item)
  - `prepPart`: Prep part records (parts within preps)
  - `prepPartItem`: Individual items (for PnP)
  - `pnpBox`: Package template
  - `pnpOrderBox`: Actual box for an order
  - `collectionPrep`: Collection prep header

- **Relationships**:
  - `order` → `customer` (via `customerId`)
  - `order` → `variantOrder[]` (via `orderId` = `shopifyOrderId`)
  - `variantOrder` → `prep` (via `lineItemId`)
  - `prep` → `prepPart[]` (via `prepId`)
  - `prepPart` → `prepPartItem[]` (via `prepPartId`)
  - `pnpOrderBox` → `prepPartItem[]` (via `pnpOrderBoxId`)
  - `collectionPrep` → `prep[]` (via `collectionPrepId`)

- **Idempotency**:
  - Orders: Check by `shopifyOrderId` (unique)
  - Customers: Check by `email` + `region`
  - Variant orders: Check by `lineItemId` (unique)
  - Preps: Composite key `[prep, region]` (prep ID is generated)

**Error Handling**

- `WmsServiceError`: Custom error for WMS-specific failures
- Database constraint violations: Caught and re-thrown with context
- Missing variants/parts: Clear error indicating which SKU was not found
- Transaction rollback: Automatic on error (Prisma transactions)

---

### 5.5 Collection Prep Creation

**Backend**

- **CollectionPrepService** (`src/services/CollectionPrepService.ts`)
  - `createCollectionPrep()`: Creates collection prep header
    - Generates UUID for collection prep ID
    - Sets boxes count to number of orders
    - Links to location
  - `validateOrderMix()`: Validates order types match declarations
    - Ensures "regular-only" orders don't have PnP items
    - Ensures "pnp-only" orders don't have regular items
    - Ensures "mixed" orders have both types

- **CreateCollectionPrepUseCase** (`src/business/createCollectionPrep/CreateCollectionPrepUseCase.ts`)
  - Generates unique collection prep ID
  - Calls service to create collection prep
  - Returns collection prep ID and region

- **CreateCollectionPrepHandler** (`src/business/createCollectionPrep/CreateCollectionPrepHandler.ts`)
  - Validates request with `createCollectionPrepRequestSchema` (Zod)
  - Calls use case
  - Handles validation errors

**Database**

- **Model**: `collectionPrep`
  - Composite key: `[id, region]`
  - Fields: `id`, `region`, `carrier`, `locationId`, `prepDate`, `boxes`, `notes`
  - Links to `prep[]` via `collectionPrepId` field on prep records

- **Updates**: After creating collection prep, updates related `prep` records to set `collectionPrepId`

**Error Handling**

- `CollectionPrepValidationError`: Thrown when order mix validation fails
- Clear error messages indicating which order violated its declared type

---

### 5.6 Main Orchestrator & CLI Entry Point

**Backend**

- **Main Orchestrator** (`src/cli.ts`)
  - CLI argument parsing (config file path, optional flags)
  - Environment validation (staging guardrails via `assertStagingEnvironment()`)
  - Configuration file reading via `InputParserService`
  - Data validation via `DataValidationService`
  - Orchestrates full flow:
    1. Seed Shopify orders via `SeedShopifyOrdersHandler`
    2. Query created Shopify orders
    3. Seed WMS entities via `SeedWmsEntitiesHandler` using Shopify order data
    4. Create collection prep via `CreateCollectionPrepHandler` (if configured)
  - Error handling and user feedback
  - Exit codes for success/failure (0 = success, 1 = error)

- **CLI Features**:
  - Accepts config file path as argument: `npm run seed <config-file.json>`
  - Optional flags: `--skip-confirmation` (bypass staging confirmation prompt)
  - Progress indicators/logging (console output)
  - Summary output with created entity counts (orders, WMS entities, collection preps)

**Infra & DevOps**

- npm script in `package.json`: `"seed": "tsx src/cli.ts"`
- TypeScript compilation works for CLI entry point
- Entry point loads environment variables via `dotenv`

**Error Handling**

- Catch and format errors from all layers (handlers, use cases, services)
- Provide actionable error messages with context
- Exit with appropriate codes (0 = success, 1 = error)
- Display staging environment info on failure

**Acceptance Criteria**:

- Can run `npm run seed config.json` and execute full flow
- Staging guardrails enforced before any operations
- Clear error messages if config file invalid or missing
- Summary output shows what was created (counts per entity type)
- Proper exit codes for scripting/automation

---

### 5.7 Environment Configuration & Setup

**Backend**

- **.env.example File** (root directory)
  - Documents all required environment variables
  - Example values (non-sensitive, staging-safe)
  - Comments explaining each variable
  - Format:
    ```
    # Database connection string (must match staging patterns: staging, stage, test, dev, uat)
    DATABASE_URL=postgresql://user:password@staging-db.example.com:5432/wms_staging
    
    # Shopify store domain (must match staging patterns: staging, stage, test, dev, uat, or .myshopify.com)
    SHOPIFY_STORE_DOMAIN=staging-store.myshopify.com
    
    # Shopify Admin API access token
    SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
    
    # Shopify API version (optional, defaults to 2024-01)
    SHOPIFY_API_VERSION=2024-01
    ```

**Infra & DevOps**

- File committed to git (not in .gitignore, but .env is ignored)
- Referenced in README.md setup instructions
- Used as template for developers setting up local environment

**Acceptance Criteria**:

- `.env.example` exists with all required variables
- README.md references it in setup instructions
- All variables documented with comments explaining purpose and constraints

---

## 6. 🧪 Testing Strategy

### Unit Testing

- **Test Runner**: Vitest
- **Coverage**: 44 tests across 9 test files (as of current implementation)
- **Structure**: Arrange-Act-Assert pattern
- **Test Files**:
  - Handler tests: Validate request validation and error handling
  - Use case tests: Test business logic with mocked services
  - Service tests: Test external integrations with mocked clients/repositories
  - Repository tests: Test database operations (can use test database)
  - Integration tests: End-to-end flow with test data

### Integration Testing

- **SeederIntegration.test.ts**: Tests full orchestration flow
  - Mocks Shopify API responses
  - Uses test database or in-memory database
  - Validates end-to-end data flow

### CLI/Integration Testing

- **End-to-End CLI Tests**: Test full CLI execution with mock services
  - Test config file parsing and validation
  - Test staging guardrail enforcement
  - Test error handling and exit codes
  - Test success flow with mocked Shopify/WMS calls
  - Test collection prep creation flow

**Acceptance Criteria**:

- CLI tests verify full orchestration flow
- Tests cover error scenarios (invalid config, staging violations, API failures)
- Tests verify correct exit codes (0 for success, 1 for errors)

### Test Data Management

- Test fixtures: JSON config files in test directory
- Database: Use separate test database or transactions that roll back
- Shopify: Mock GraphQL responses (no actual API calls in tests)

### Quality Gates

- All tests must pass before merge
- Type checking: `npm run typecheck`
- Linting: `npm run lint`
- Formatting: `npm run format:check`

---

## 7. 🧩 Additional Details

### Configuration File Format

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

### Tagging Strategy

- **Shopify Orders**: Tagged with `wms_seed_<batchId>` where batchId is UUID generated per run
- **WMS Records**: 
  - Orders: `sourceName: "wms_seed"` field
  - All records can be identified by creation timestamp and source
  - Batch ID stored in Shopify order tags (can be queried)

### Idempotency Strategy

- **Shopify**: Check for existing orders by tag before creating
- **WMS**: 
  - Orders: Check by `shopifyOrderId` (unique constraint)
  - Customers: Check by `email` + `region`
  - Variant orders: Check by `lineItemId` (unique constraint)
  - If record exists, skip creation and return existing ID

### Performance Considerations

- **Sequential Processing**: Orders processed one at a time to avoid rate limits
- **Batch Queries**: Variant lookups batched (single query for all SKUs)
- **Transactions**: Used for atomic operations (order + customer creation)

### Documentation Structure

- **AGENTS.md**: Engineering conventions, quickstart, tooling (agent-focused instructions)
- **docs/architecture.md**: System architecture, data flows, component relationships (separate from AGENTS.md)
- **docs/implementation/progress.md**: Implementation progress tracking
- **README.md**: User-facing documentation, setup, usage instructions
- **Technical Design Document**: This document (design decisions, approach rationale, implementation details)

---

## 8. ⚠️ Risks & Mitigations

| Risk | Mitigation Strategy |
|------|---------------------|
| **Accidental production execution** | Hard-coded staging guardrails that check DB URL and Shopify domain patterns. Execution fails immediately if production detected. |
| **Shopify API rate limits** | Sequential processing of orders. Future: Add exponential backoff retry logic. |
| **Database connection failures** | Prisma connection pooling. Clear error messages. Future: Add retry logic with backoff. |
| **Missing SKUs/variants in WMS** | Validation service checks SKUs exist before seeding. Clear error messages indicating which SKU is missing. |
| **Data inconsistency between Shopify and WMS** | Use Shopify order data as source of truth. WMS entities created from Shopify order details. |
| **Partial failures leaving orphaned records** | Idempotent operations allow safe re-runs. Transactions ensure atomicity for related records. |
| **Schema changes breaking seeder** | Prisma schema versioning. TypeScript compilation catches breaking changes. Tests validate schema compatibility. |

---

## 9. 📊 Build Estimate

| Phase/Functionality | Estimate | Start Date | End Date |
|---------------------|----------|------------|----------|
| **Phase 1: Foundation & Dependencies** | ✅ Complete | - | - |
| **Phase 2: Shopify Seeding** | ✅ Complete | - | - |
| **Phase 3: WMS Seeding** | ✅ Complete | - | - |
| **Phase 4: Collection Prep** | ✅ Complete | - | - |
| **Phase 5: Testing** | ✅ Complete | - | - |
| **Phase 6: Orchestrator & CLI** | ✅ Complete | - | - |
| **Phase 7: Documentation** | ✅ Complete | - | - |
| **Phase 8: Polish & Quality** | 4 hours | TBD | TBD |
| - Final testing of end-to-end flow | 2 hours | | |
| - Error message improvements | 1 hour | | |
| - Performance validation | 1 hour | | |
| **Total Remaining** | **4 hours** | | |

*Note: Core implementation (Phases 1-7) is complete. Remaining work focuses on final polish and quality validation.*

---

## 10. ✅ Sign Off

| Name | Status | Date | Notes |
|------|--------|------|-------|
| Sam Morrison | ⏳ Pending | | Project Champion - Awaiting review |
| Engineering Manager | ⏳ Pending | | |
| Staff Engineer | ⏳ Pending | | |
