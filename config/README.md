# Configuration Files

This directory contains JSON configuration files used by the seeder.

## customers.json

Pre-defined customer data for each fulfillment center (FC) location.

### Structure

```json
{
  "customers": [
    {
      "id": "test-customer-langley-1",
      "name": "Test Customer Langley 1",
      "email": "test-langley-1@example.com",
      "address": "200 Granville Street",
      "city": "Vancouver",
      "province": "BC",
      "postalCode": "V6C 1S4",
      "region": "CA",
      "locationId": "langley"
    }
  ]
}
```

### Required Fields

| Field        | Type   | Description                | Validation                               |
| ------------ | ------ | -------------------------- | ---------------------------------------- |
| `id`         | string | Unique customer identifier | Must be unique across all customers      |
| `name`       | string | Customer display name      | Any non-empty string                     |
| `email`      | string | Customer email             | Must be valid email format               |
| `address`    | string | Street address             | Required for order creation              |
| `city`       | string | City name                  | Required for order creation              |
| `province`   | string | Province/state code        | 2-letter code (e.g., BC, ON, CA, NY)     |
| `postalCode` | string | Postal/ZIP code            | See format requirements below            |
| `region`     | string | Country region             | "CA" or "US"                             |
| `locationId` | string | FC location identifier     | Must match `location.id` in WMS database |

### Postal Code Formats

**Canadian postal codes** (region: "CA"):

- Format: `A1A 1A1` or `A1A1A1` (space optional)
- Pattern: Letter-Number-Letter [space] Number-Letter-Number
- Examples: `V6C 1S4`, `H2Y1C6`, `N9A 6S1`

**US ZIP codes** (region: "US"):

- Format: `12345` or `12345-6789`
- Pattern: 5 digits, optionally followed by hyphen and 4 digits
- Examples: `90001`, `08810`, `92553-1234`

### Location IDs

Location IDs must match valid locations in the WMS database:

**Canadian locations**:

- `langley`: Langley, BC warehouse
- `windsor`: Windsor, ON warehouse
- `royalmount`: Royalmount/Montreal, QC warehouse

**US locations**:

- `moreno`: Moreno Valley, CA warehouse
- `dayton`: Dayton, NJ warehouse (South Brunswick area)

### Carrier Compatibility

Customer postal codes should be compatible with at least one carrier serving their region. Use the validation script to verify:

```bash
npx tsx scripts/validate-customer-postal-codes.ts
```

**Carrier types**:

- **National carriers** (serve all postal codes): Nationex, Puro, Canpar, FedEx
- **Regional carriers** (serve specific postal codes): GoBolt Vancouver, GoBolt Toronto, GoBolt Montreal, GLS Go! Post, GoBolt NYC

All current customer addresses are validated and compatible with carrier routing rules.

### Address Selection Guidelines

When updating customer addresses:

1. **Use real addresses**: Shopify validates addresses; fake addresses may be rejected
2. **Near warehouse locations**: Choose addresses in the same region as the locationId
3. **Public/commercial addresses**: Use government buildings, public facilities, or major retailers
4. **Unique addresses**: Each customer should have a different street address
5. **Postal code compatibility**: Verify postal codes match carrier routing rules (run validation script)
6. **Validate format**: Ensure postal codes match the correct format for the region

### Current Addresses (Updated: 2026-01-19)

**Langley, BC customers**:

- test-customer-langley-1: 200 Granville Street, Vancouver, BC V6C 1S4
- test-customer-langley-2: 13737 96 Avenue, Surrey, BC V3V 0C6
- test-customer-langley-3: 4949 Canada Way, Burnaby, BC V5G 1M2

**Windsor, ON customers**:

- test-customer-windsor-1: 350 City Hall Square West, Windsor, ON N9A 6S1
- test-customer-windsor-2: 1155 Lauzon Road, Windsor, ON N8S 3N1
- test-customer-windsor-3: 3000 Dougall Avenue, Windsor, ON N9E 1S3

**Royalmount, QC customers**:

- test-customer-royalmount-1: 275 Rue Notre-Dame Est, Montreal, QC H2Y 1C6
- test-customer-royalmount-2: 1250 Boulevard René-Lévesque Ouest, Montreal, QC H3B 4W8
- test-customer-royalmount-3: 1055 Rue Saint-Laurent Ouest, Longueuil, QC J4K 1C7

**Moreno, CA customers**:

- test-customer-moreno-1: 14177 Frederick Street, Moreno Valley, CA 92553
- test-customer-moreno-2: 3900 Main Street, Riverside, CA 92501
- test-customer-moreno-3: 290 North D Street, San Bernardino, CA 92401

**Dayton, NJ customers**:

- test-customer-dayton-1: 129 Ridge Road, Dayton, NJ 08810
- test-customer-dayton-2: 3681 US Highway 1, South Brunswick, NJ 08852
- test-customer-dayton-3: 1 Distribution Boulevard, Edison, NJ 08817

**Rationale**: All addresses are real public buildings (city halls, government facilities) near warehouse locations. All postal codes validated against carrier routing rules.

## carriers.json

Carrier definitions and postal code routing rules. See `src/shared/carriers.ts` for code constants.

### Structure

Each carrier has:

- `code`: Carrier identifier (e.g., "Fedex", "GoBoltVancouver")
- `name`: Display name
- `region`: "CA", "US", or null (available for all regions)
- `minimumBoxesQty`: Minimum number of boxes for carrier (optional)
- `nearestWarehouses`: List of warehouse locations served by carrier
- `postalCodes`: Array of postal code prefixes served by carrier (optional)

### Carrier Types

**National carriers** (no postal code restrictions):

- Nationex, Puro, Canpar, FedEx
- These carriers can serve any postal code in their region

**Regional carriers** (specific postal code lists):

- GoBolt Vancouver, GoBolt Toronto, GoBolt Montreal (Canada)
- GoBolt NYC, GLS Go! Post (US)
- These carriers only serve specific postal code prefixes listed in `postalCodes`

### Usage

The seeder doesn't directly use `carriers.json` at runtime (carriers are code constants in `src/shared/carriers.ts`). However, the postal code lists are useful for:

- Validating customer addresses match carrier routing capabilities
- Understanding which carriers serve which warehouse locations
- Troubleshooting carrier assignment issues

### Validation

To verify customer postal codes are compatible with carrier routing:

```bash
npx tsx scripts/validate-customer-postal-codes.ts
```

## orderTemplates.json

Saved order templates created by the config generator. This file is optional and created automatically when saving templates.

### Structure

```json
{
  "templates": [
    {
      "name": "My Template",
      "order": {
        /* order structure */
      }
    }
  ]
}
```

### Usage

Templates can be loaded in the config generator to quickly create similar orders without re-entering data.

**Commands**:

- Create: Run `npm run generate-config` and save order as template
- Use: Select "Load from template" when creating orders in config generator

## Maintenance

When modifying configuration files:

1. **Validate JSON syntax**: Use `jq . config/customers.json` or JSON linter
2. **Run validation**: Test with `npm run seed <config> --validate`
3. **Validate postal codes**: Run `npx tsx scripts/validate-customer-postal-codes.ts`
4. **Test in staging**: Use `--dry-run` before actual seeding
5. **Update this README**: Document significant changes and rationale
6. **Update CHANGELOG.md**: Record changes with date and reason

### Common Issues

**"Customer X is missing required address fields"**:

- Ensure all address fields present: address, city, province, postalCode
- Check for typos in field names (case-sensitive)
- Verify no null or empty string values

**"Customer X has invalid postal code format"**:

- Canadian: Must match A1A 1A1 or A1A1A1 (letter-number-letter space? number-letter-number)
- US: Must match 12345 or 12345-6789 (5 or 9 digits)
- Remove any special characters except space (CA) or hyphen (US)

**"No carrier serves postal code prefix"**:

- Postal code might not be in regional carrier lists
- National carriers (FedEx, Nationex, etc.) can serve all postal codes
- Run validation script to see which carriers match

## Related Documentation

- [README.md](../README.md): User-facing quickstart and usage
- [docs/architecture.md](../docs/architecture.md): System architecture and data flows
- [docs/runbook.md](../docs/runbook.md): Operations guide and troubleshooting
- [AGENTS.md](../AGENTS.md): Engineering conventions
