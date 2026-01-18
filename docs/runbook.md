# Runbook: Operations & Troubleshooting Guide

**Last Updated:** 2025-01-17  
**Primary Owner:** Sam Morrison

## Purpose

This runbook provides operational guidance for running, troubleshooting, and maintaining the Cozey UAT Seeder. It covers common issues, incident playbooks, and environment configuration details.

## Environment Configuration

### Required Environment Variables

The seeder requires the following environment variables (see `.env.example` for details):

**Database:**
- `DATABASE_URL` - PostgreSQL connection string (must match staging patterns)

**Shopify:**
- `SHOPIFY_STORE_DOMAIN` - Shopify store domain (must match staging patterns)
- `SHOPIFY_ACCESS_TOKEN` - Shopify Admin API access token
- `SHOPIFY_API_VERSION` - API version (optional, defaults to 2024-01)

**AWS Secrets Manager (Optional):**
- `USE_AWS_SECRETS` - Enable/disable AWS secrets (default: `true`)
- `AWS_REGION` - AWS region (default: `us-east-1`)
- `AWS_PROFILE` - AWS profile name (optional)
- `AWS_DATABASE_SECRET_NAME` - Database secret name (default: `dev/uat-database-url`)
- `AWS_SHOPIFY_SECRET_NAME` - Shopify secret name (default: `dev/shopify-access-token`)

### Staging Environment Patterns

The seeder enforces staging-only execution via hard-coded guardrails:

**Database URL patterns (any match):**
- `/staging/i`
- `/stage/i`
- `/test/i`
- `/dev/i`
- `/uat/i`

**Shopify domain patterns (any match):**
- Same as database patterns above
- `/.myshopify.com$/i` (any `.myshopify.com` domain)

**Verification:**
- Run with `--dry-run` flag to test environment without making changes
- Staging check happens before any database or API operations

## Common Issues & Solutions

### Staging Guardrail Violation

**Symptom:**
```
❌ Staging Guardrail Violation:
   Database URL does not match staging patterns
```

**Causes:**
- `DATABASE_URL` contains production database connection
- `SHOPIFY_STORE_DOMAIN` points to production store

**Solution:**
1. Verify environment variables are set correctly
2. Check that `DATABASE_URL` contains staging keywords (staging, stage, test, dev, uat)
3. Check that `SHOPIFY_STORE_DOMAIN` matches staging patterns
4. If using AWS Secrets Manager, verify secret values are correct

**Prevention:**
- Always use `.env` files for local development
- Never commit `.env` files to git
- Use `--dry-run` flag to test before actual execution

### Database Connection Issues

**Symptom:**
```
Error: P1001: Can't reach database server
```

**Causes:**
- Database server is down or unreachable
- Network connectivity issues
- Incorrect `DATABASE_URL`
- Database credentials expired or incorrect
- Connection pool exhausted

**Solution:**
1. **Verify database is accessible:**
   ```bash
   # Test connection (replace with your DATABASE_URL)
   psql $DATABASE_URL -c "SELECT 1"
   ```

2. **Check connection string format:**
   ```
   postgresql://user:password@host:port/database
   ```

3. **Verify credentials:**
   - If using AWS Secrets Manager, check secret values
   - If using `.env`, verify values are correct

4. **Check connection pool settings:**
   - Default limit: 10 connections
   - Can be overridden with `DATABASE_CONNECTION_LIMIT` env var
   - Add `?connection_limit=N` to `DATABASE_URL` if needed

5. **Network issues:**
   - Verify VPN connection (if required)
   - Check firewall rules
   - Verify database is in same network/VPC

**Prevention:**
- Use connection pooling (Prisma handles this automatically)
- Set appropriate connection limits
- Monitor connection usage

### Shopify API Rate Limiting

**Symptom:**
```
Error: Shopify API rate limit exceeded
```

**Causes:**
- Too many API requests in short time
- Shopify Admin API has rate limits (varies by plan)

**Solution:**
1. **Wait and retry:**
   - Shopify rate limits reset over time
   - Wait a few minutes and retry

2. **Reduce batch size:**
   - Process fewer orders per run
   - Split large configs into smaller files

3. **Check rate limit status:**
   - Shopify API responses include rate limit headers
   - Check `X-Shopify-Shop-Api-Call-Limit` header

**Prevention:**
- Seeder processes orders sequentially (not in parallel)
- This helps avoid rate limits but may be slow for large batches
- Consider splitting very large seed operations

### Missing SKUs/Variants

**Symptom:**
```
❌ Data validation failed:
   Missing SKUs in WMS: SOFA-CHAR-BLK, PILLOW-STD-WHT
```

**Causes:**
- SKUs don't exist in WMS database
- SKUs exist but in different region
- SKUs are disabled or inactive

**Solution:**
1. **Verify SKUs exist:**
   ```sql
   -- Check if variant exists
   SELECT sku, region FROM variant WHERE sku = 'SOFA-CHAR-BLK' AND region = 'CA';
   ```

2. **Check region:**
   - Ensure config region matches database region
   - CA and US have separate variant records

3. **Check variant status:**
   ```sql
   -- Check if variant is disabled
   SELECT sku, disabled FROM variant WHERE sku = 'SOFA-CHAR-BLK' AND region = 'CA';
   ```

4. **Use available SKUs:**
   - Run `npm run generate-config` to see available SKUs
   - Or query database directly for available variants

**Prevention:**
- Use `--validate` flag to check config before seeding
- Use `generate-config` tool to ensure valid SKUs
- Keep list of available test SKUs documented

### Configuration File Validation Errors

**Symptom:**
```
❌ Configuration file validation failed:
   orders[0].lineItems[0].quantity: Expected number, received string
```

**Causes:**
- JSON syntax errors
- Type mismatches (string instead of number)
- Missing required fields
- Invalid enum values

**Solution:**
1. **Validate JSON syntax:**
   ```bash
   # Use jq or online JSON validator
   cat config.json | jq .
   ```

2. **Check schema:**
   - See `src/shared/validation/seedConfigSchema.ts` for schema definition
   - Ensure all required fields are present
   - Verify field types match schema

3. **Use validation flag:**
   ```bash
   npm run seed config.json --validate
   ```

4. **Common issues:**
   - Quantities must be numbers, not strings: `"quantity": 1` not `"quantity": "1"`
   - Dates must be ISO 8601 format: `"2026-01-20T10:00:00Z"`
   - Enums must match exactly: `"pickType": "Regular"` not `"pickType": "regular"`

**Prevention:**
- Always use `--validate` flag before actual seeding
- Use `generate-config` tool to create valid configs
- Review schema documentation

### AWS Secrets Manager Issues

**Symptom:**
```
⚠️  Failed to fetch secret from AWS: dev/uat-database-url
   Falling back to .env file
```

**Causes:**
- AWS credentials not configured
- Secret doesn't exist in AWS Secrets Manager
- IAM permissions insufficient
- Wrong AWS region
- Secret name mismatch

**Solution:**
1. **Verify AWS credentials:**
   ```bash
   # Check AWS credentials
   aws sts get-caller-identity
   ```

2. **Check secret exists:**
   ```bash
   # List secrets
   aws secretsmanager list-secrets --region us-east-1
   
   # Get secret value (if you have permissions)
   aws secretsmanager get-secret-value --secret-id dev/uat-database-url --region us-east-1
   ```

3. **Verify IAM permissions:**
   - Required: `secretsmanager:GetSecretValue`
   - Check IAM policy for user/role

4. **Check AWS region:**
   - Verify `AWS_REGION` matches secret's region
   - Check secret ARN to determine region

5. **Verify secret names:**
   - Default: `dev/uat-database-url` and `dev/shopify-access-token`
   - Can override with `AWS_DATABASE_SECRET_NAME` and `AWS_SHOPIFY_SECRET_NAME`

6. **Disable AWS secrets (fallback):**
   - Set `USE_AWS_SECRETS=false` in `.env`
   - Seeder will use `.env` file only

**Prevention:**
- Configure AWS credentials properly
- Document secret names and regions
- Use `.env` files for local development

### Partial Seeding Failures

**Symptom:**
- Some orders created in Shopify but not in WMS
- Some WMS entities created but collection prep missing

**Causes:**
- Error occurred mid-execution
- Transaction rollback on error
- Network timeout

**Solution:**
1. **Re-run seeder:**
   - Seeder is idempotent
   - Re-running will skip already-created records
   - Check for existing records before creating

2. **Check what was created:**
   ```sql
   -- Check created orders
   SELECT shopifyOrderId, shopifyOrderNumber, sourceName 
   FROM "order" 
   WHERE sourceName = 'wms_seed' 
   ORDER BY createdAt DESC;
   ```

3. **Clean up if needed:**
   - Identify seed records by `sourceName = 'wms_seed'`
   - Or by batch ID in Shopify order tags
   - Manually delete if needed (be careful!)

**Prevention:**
- Use `--dry-run` to preview changes
- Process orders sequentially (already implemented)
- Use transactions for atomicity (already implemented)

## Incident Playbooks

### Database Connection Lost During Seeding

**Scenario:** Database connection fails mid-execution

**Steps:**
1. Check database server status
2. Verify network connectivity
3. Check connection pool exhaustion
4. Re-run seeder (idempotent, will skip existing records)
5. Verify all records created correctly

### Shopify API Returns Errors

**Scenario:** Shopify API returns errors for some orders

**Steps:**
1. Check error message for specific issue
2. Verify SKUs exist in Shopify store
3. Check Shopify store status
4. Verify API credentials are valid
5. Check rate limits
6. Fix config and re-run (idempotent)

### Staging Guardrail Fails in Production

**Scenario:** (Should never happen, but if it does)

**Steps:**
1. **STOP IMMEDIATELY** - Do not proceed
2. Verify environment variables
3. Check if guardrail logic is working
4. Report issue immediately
5. Do not bypass guardrails

## Health Checks

### Pre-Seeding Checklist

Before running the seeder:

- [ ] Environment variables configured (`.env` or AWS Secrets)
- [ ] Database connection testable
- [ ] Shopify API credentials valid
- [ ] Config file validated (`--validate` flag)
- [ ] Staging environment confirmed
- [ ] Dry-run successful (`--dry-run` flag)

### Post-Seeding Verification

After running the seeder:

- [ ] Check seeder output for success messages
- [ ] Verify orders created in Shopify (check by tag)
- [ ] Verify WMS entities created (query database)
- [ ] Check collection prep created (if configured)
- [ ] Verify shipments created (if collection prep exists)

### Verification Queries

**Check created orders:**
```sql
SELECT shopifyOrderId, shopifyOrderNumber, status, sourceName, createdAt
FROM "order"
WHERE sourceName = 'wms_seed'
ORDER BY createdAt DESC
LIMIT 10;
```

**Check collection preps:**
```sql
SELECT id, region, carrier, locationId, prepDate, boxes, createdAt
FROM collectionPrep
WHERE createdAt > NOW() - INTERVAL '1 hour'
ORDER BY createdAt DESC;
```

**Check Shopify orders (via Shopify Admin):**
- Filter by tag: `wms_seed_<batchId>`
- Or search for orders with notes containing "WMS Seed"

## Performance Considerations

### Large Batch Seeding

For seeding many orders (10+):

1. **Sequential Processing:**
   - Orders processed one at a time (by design)
   - Prevents rate limiting but may be slow

2. **Estimated Time:**
   - ~5-10 seconds per order (Shopify API calls + DB operations)
   - 10 orders ≈ 1-2 minutes
   - 50 orders ≈ 5-10 minutes

3. **Optimization Tips:**
   - Split large configs into smaller batches
   - Use `--dry-run` to estimate time
   - Process during off-peak hours if possible

### Database Performance

- Connection pooling handled by Prisma (default: 10 connections)
- Transactions used for atomicity
- Batch queries used where possible (variant lookups)

## Monitoring & Logging

### Log Levels

The seeder uses structured logging:
- **Debug:** GraphQL cost tracking, detailed operation info
- **Info:** Progress messages, summary information
- **Error:** Failures, validation errors

### Key Log Messages

**Success:**
```
✅ Created 2 Shopify order(s)
✅ Created 2 WMS order(s)
✅ Created 1 collection prep: CP-20260117-001
```

**Errors:**
```
❌ Configuration file validation failed: ...
❌ Data validation failed: Missing SKUs in WMS: ...
❌ Staging Guardrail Violation: ...
```

### Debugging Tips

1. **Enable debug logging:**
   - Set `LOG_LEVEL=debug` in environment (if supported)
   - Or check code for Logger.debug calls

2. **Check GraphQL costs:**
   - Debug logs include GraphQL API cost information
   - Useful for monitoring API usage

3. **Dry-run mode:**
   - Use `--dry-run` to see what would happen
   - No actual changes made

## Related Documentation

- [README.md](../README.md) - Quickstart and usage
- [Architecture Documentation](architecture.md) - System architecture
- [Data Model Documentation](data-model.md) - Database schema details
- [AGENTS.md](../AGENTS.md) - Engineering conventions
