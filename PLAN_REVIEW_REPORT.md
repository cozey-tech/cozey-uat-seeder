# Plan Review Report: CLI Tools UX/Design Review Implementation

## 1) What the plan is trying to do (scope + outcomes)

**Objective**: Implement comprehensive improvements to both CLI tools (seeding CLI and config generator) based on UX/design reviews, including:
- Progress visibility and time estimates
- Actionable error messages with recovery guidance
- Code organization (split large files)
- Standardized error handling and output formatting
- Enhanced logging and observability

**Success Criteria** (from plan):
- Progress visible for all major steps
- Time estimates shown
- All errors show formatted messages with recovery suggestions
- File structure organized (large files split)
- Structured logging used consistently
- All existing functionality maintained
- Tests pass

**Current Plan Status**: 5 phases over 5 weeks, 14 tasks total. Plan assumes incremental improvements with backward compatibility.

## 2) What's already implemented vs remaining (repo reality check)

### Already Implemented
- ✅ BaseHandler pattern (`src/business/BaseHandler.ts`) - reduces duplication
- ✅ Error handling improvements in WmsPrismaRepository (handlePrismaError method)
- ✅ Test coverage tooling (`@vitest/coverage-v8` configured)
- ✅ Bulk order creation modes in config generator (individual, bulk-template, quick-duplicate)
- ✅ Order review step in config generator
- ✅ Collection prep builder modes (bulk, multiple, single)
- ✅ Performance metrics tracking in config generator
- ✅ Continue-on-error strategy in SeedShopifyOrdersUseCase (partial failures handled)

### Not Implemented (All plan tasks are pending)
- Progress tracking utility
- Error formatter utility
- Output formatter utility
- CLI file refactoring
- Enhanced logging integration
- Confirmation before save
- Cancel/back options
- Standardized output formatting

### Code Locations
- `src/cli.ts` (488 lines) - Seeding orchestrator, needs refactoring
- `src/generateConfig.ts` (1019 lines) - Config generator, needs refactoring
- `src/utils/logger.ts` - Simple logger, not used consistently
- Error classes exist but formatting inconsistent

## 3) Issues found (prioritized)

### Issue 1: Seeding CLI Doesn't Show Partial Failure Summary (CRITICAL)
**Severity**: Critical  
**Evidence**: 
- `SeedShopifyOrdersUseCase.ts:226-247` implements continue-on-error strategy
- Errors are collected but CLI (`src/cli.ts:259`) only shows success count
- If 5/10 orders fail, user only sees "Created 5 Shopify order(s)" with no indication of failures
- No summary of which orders failed or why

**Why it matters**:
- **User**: Unaware that some orders failed, proceeds with incomplete data
- **Team**: Hard to debug partial failures, no visibility into what went wrong
- **Business**: Data integrity issues, incomplete test scenarios

**Fix recommendation**:
- Display failure summary after Shopify seeding: "Created 5/10 orders. 5 failed: [list]"
- Show failure details: order index, customer email, error message
- Ask user if they want to continue with partial success or abort
- Add similar failure handling for WMS seeding

### Issue 2: No Help/Version Flags (HIGH)
**Severity**: High  
**Evidence**:
- `src/cli.ts:52-62` - Usage shown only on error, no `--help` flag
- `src/generateConfig.ts:44-92` - No help flag
- No `--version` flag in either tool
- Users must trigger error to see usage

**Why it matters**:
- **User**: Can't discover available options without reading code/docs
- **Team**: Poor CLI UX, not following standard conventions
- **Business**: Reduced usability, harder onboarding

**Fix recommendation**:
- Add `--help` flag showing usage and all options
- Add `--version` flag showing tool version
- Use proper CLI argument parser (commander.js, yargs, or similar)
- Show help by default if no arguments provided

### Issue 3: Silent Service Initialization (HIGH)
**Severity**: High  
**Evidence**:
- `src/cli.ts:447` - "Initializing services..." but no details
- `src/generateConfig.ts:227-238` - Services initialized silently
- No indication of what's being initialized or if it succeeded
- Database connection happens silently

**Why it matters**:
- **User**: Unclear if tool is working or stuck during initialization
- **Team**: Hard to debug initialization failures
- **Business**: Poor user experience, appears unresponsive

**Fix recommendation**:
- Show initialization steps: "Connecting to database...", "Initializing Shopify client...", etc.
- Show success indicators for each step
- Show timing for initialization
- Handle initialization failures gracefully

### Issue 4: No Progress Within Seeding Steps (HIGH)
**Evidence**:
- `src/cli.ts:245` - "Step 1: Seeding Shopify orders..." but no progress for 50 orders
- `SeedShopifyOrdersUseCase.ts:99-252` - Processes orders in parallel but CLI doesn't show progress
- User sees nothing for potentially minutes during large batches
- No indication of which order is being processed

**Why it matters**:
- **User**: Unclear if tool is working during long operations
- **Team**: Users interrupt thinking it's hung
- **Business**: Reduced confidence, slower adoption

**Fix recommendation**:
- Show progress: "Processing order 5/50 (customer@example.com)..."
- Show time estimates: "~2 minutes remaining"
- Show parallel processing status: "10 orders in progress..."
- Update progress in real-time

### Issue 5: Config Generator Doesn't Show What's Being Loaded (MEDIUM)
**Severity**: Medium  
**Evidence**:
- `src/generateConfig.ts:245` - "Loading reference data..." but no details
- User doesn't know what's being loaded (variants, customers, carriers)
- No progress indication for large datasets
- Silent failures possible (e.g., template loading)

**Why it matters**:
- **User**: Unclear what's happening during load
- **Team**: Hard to debug loading issues
- **Business**: Appears slow or broken

**Fix recommendation**:
- Show loading steps: "Loading variants...", "Loading customers...", "Loading carriers..."
- Show progress: "Loaded 150/200 variants..."
- Show timing for each load operation
- Handle loading failures gracefully

### Issue 6: No Preview of Generated Config Before Save (MEDIUM)
**Severity**: Medium  
**Evidence**:
- `src/generateConfig.ts:954-966` - Config saved immediately after validation
- No preview option (except in dry-run mode)
- User can't review config structure before saving
- No confirmation prompt

**Why it matters**:
- **User**: Can't verify config is correct before saving
- **Team**: Accidental overwrites, incorrect configs
- **Business**: Data quality issues

**Fix recommendation**:
- Add preview option: "Preview config before saving? (y/n)"
- Show config summary (not full JSON, but key details)
- Add confirmation: "Save to output/seed-config.json? (y/n)"
- Warn if file exists: "File exists. Overwrite? (y/n)"

### Issue 7: Error Messages Don't Show Context (MEDIUM)
**Severity**: Medium  
**Evidence**:
- `src/cli.ts:470-479` - Generic error messages
- `src/generateConfig.ts:1001-1010` - Error messages lack context
- No indication of which step failed
- No indication of which order/config item failed

**Why it matters**:
- **User**: Hard to understand what went wrong
- **Team**: Hard to debug issues
- **Business**: Increased support burden

**Fix recommendation**:
- Include step context: "Step 2 (WMS seeding) failed: ..."
- Include order context: "Order 3/10 (customer@example.com) failed: ..."
- Include config context: "Collection prep configuration failed: ..."
- Show what was successful before failure

### Issue 8: No Resume/Retry Capability (MEDIUM)
**Severity**: Medium  
**Evidence**:
- If seeding fails partway, must restart from beginning
- No way to resume from last successful order
- No way to retry failed orders only
- Batch ID exists but not used for resume

**Why it matters**:
- **User**: Wasted time restarting long operations
- **Team**: Inefficient workflow
- **Business**: Slower testing cycles

**Fix recommendation**:
- Add `--resume <batch-id>` flag to resume from batch
- Store progress state (which orders succeeded)
- Allow retry of failed orders only
- Show resume options on failure

### Issue 9: Inconsistent Progress Feedback (MEDIUM)
**Severity**: Medium  
**Evidence**:
- Some operations show progress (bulk order creation: "Created 10 of 50...")
- Other operations show nothing (Shopify seeding, WMS seeding)
- No consistent progress format
- Some show timing, others don't

**Why it matters**:
- **User**: Inconsistent experience
- **Team**: Hard to predict operation duration
- **Business**: Appears unpolished

**Fix recommendation**:
- Standardize progress format across all operations
- Always show progress for operations > 1 second
- Always show timing for long operations
- Use consistent progress indicators

### Issue 10: No Validation Feedback During Config Generation (LOW)
**Severity**: Low  
**Evidence**:
- `src/generateConfig.ts:928-939` - Validation happens at end
- No validation during order creation
- User might create invalid config and only find out at end
- No incremental validation feedback

**Why it matters**:
- **User**: Wasted time creating invalid config
- **Team**: Frustrating workflow
- **Business**: Reduced efficiency

**Fix recommendation**:
- Validate orders as they're created
- Show warnings for potential issues (e.g., "Order has no PnP items but PnP config provided")
- Validate collection prep configuration as it's built
- Show validation status in review step

### Issue 11: No Command History or Templates (LOW)
**Severity**: Low  
**Evidence**:
- No way to save/load common configs
- No command history
- Must recreate similar configs from scratch each time
- Templates exist for orders but not for full configs

**Why it matters**:
- **User**: Repetitive work for similar scenarios
- **Team**: Inefficient for common use cases
- **Business**: Slower testing setup

**Fix recommendation**:
- Add config templates (save/load full configs)
- Add command history (last N configs)
- Add quick config options (common scenarios)
- Allow importing existing configs as starting point

### Issue 12: No Dry-Run Feedback for Config Generator (LOW)
**Severity**: Low  
**Evidence**:
- `src/generateConfig.ts:949-952` - Dry-run shows JSON but no summary
- No indication of what would be created
- No validation in dry-run mode
- Hard to understand dry-run output

**Why it matters**:
- **User**: Unclear what dry-run shows
- **Team**: Less useful for testing
- **Business**: Reduced confidence in tool

**Fix recommendation**:
- Show summary in dry-run: "Would create 10 orders, 2 collection preps"
- Show validation results in dry-run
- Format dry-run output better (not just raw JSON)
- Show what operations would be performed

## 4) Plan Patch (diff-style)

### CHANGE: Assumptions Section (line 105-111)

**Before**:
```markdown
### Assumptions

- Users are technical (engineers/QA)
- Terminal-based interaction is acceptable
- Focus on efficiency for bulk operations
- Staging environment only (safety guardrails exist)
- No breaking changes to existing functionality
```

**After**:
```markdown
### Assumptions

- Users are technical (engineers/QA)
- Terminal-based interaction is acceptable
- Focus on efficiency for bulk operations
- Staging environment only (safety guardrails exist)
- **Comprehensive refactor acceptable** - tool not yet released, breaking changes allowed
- Can make architectural improvements without backward compatibility concerns
```

### CHANGE: Options Section (line 108-139)

**Before**:
```markdown
**Recommendation**: Option A - Incremental improvements phased by priority
```

**After**:
```markdown
**Recommendation**: Option B - Comprehensive Refactor (user confirmed tool not released, time available for proper refactoring)
```

### ADD: New Task in Phase 1

**After Task 1.4, add**:

#### Task 1.5: Add Help and Version Flags
**Files**: `src/cli.ts`, `src/generateConfig.ts`, `package.json`
**Goal**: Standard CLI help and version support
**Steps**:
1. Install CLI argument parser (commander.js or yargs)
2. Add `--help` flag showing usage and all options
3. Add `--version` flag showing tool version from package.json
4. Show help by default if no arguments provided
5. Update both CLI tools

**Acceptance Criteria**:
- `--help` shows comprehensive usage
- `--version` shows correct version
- Help shown by default with no args
- All options documented in help

**Effort**: Small | **Risk**: Low

### ADD: New Task in Phase 1

#### Task 1.6: Add Partial Failure Summary to Seeding CLI
**Files**: `src/cli.ts`, `src/business/seedShopifyOrders/SeedShopifyOrdersUseCase.ts`
**Goal**: Show failure summary when orders fail
**Steps**:
1. Update SeedShopifyOrdersResponse to include failures array
2. Display failure summary in CLI after Shopify seeding
3. Show failure details (order index, customer, error)
4. Ask user if they want to continue with partial success
5. Add similar handling for WMS seeding failures

**Acceptance Criteria**:
- Failure summary shown when orders fail
- User can choose to continue or abort
- Failure details clearly displayed
- Works for both Shopify and WMS seeding

**Effort**: Medium | **Risk**: Low

### ADD: New Task in Phase 2

#### Task 2.4: Add Service Initialization Feedback
**Files**: `src/cli.ts`, `src/generateConfig.ts`
**Goal**: Show initialization progress
**Steps**:
1. Add initialization steps tracking
2. Show each initialization step: "Connecting to database...", "Initializing Shopify client..."
3. Show success indicators for each step
4. Show timing for initialization
5. Handle initialization failures gracefully

**Acceptance Criteria**:
- All initialization steps visible
- Success indicators shown
- Timing displayed
- Failures handled gracefully

**Effort**: Small | **Risk**: Low

### ADD: New Task in Phase 2

#### Task 2.5: Add Progress Within Seeding Steps
**Files**: `src/cli.ts`, `src/business/seedShopifyOrders/SeedShopifyOrdersUseCase.ts`, `src/business/seedWmsEntities/SeedWmsEntitiesUseCase.ts`
**Goal**: Show progress during long operations
**Steps**:
1. Add progress callbacks to use cases
2. Show order-by-order progress: "Processing order 5/50 (customer@example.com)..."
3. Show time estimates: "~2 minutes remaining"
4. Show parallel processing status
5. Update progress in real-time

**Acceptance Criteria**:
- Progress visible for all orders
- Time estimates shown
- Parallel processing status visible
- Real-time updates

**Effort**: Medium | **Risk**: Low

### ADD: New Task in Phase 2

#### Task 2.6: Add Config Preview Before Save
**Files**: `src/generateConfig.ts`
**Goal**: Allow preview and confirmation before saving
**Steps**:
1. Add preview option: "Preview config before saving? (y/n)"
2. Show config summary (key details, not full JSON)
3. Add confirmation: "Save to output/seed-config.json? (y/n)"
4. Warn if file exists: "File exists. Overwrite? (y/n)"
5. Allow cancellation

**Acceptance Criteria**:
- Preview option works
- Summary shows key details
- Confirmation required
- Overwrite warning works

**Effort**: Small | **Risk**: Low

### ADD: New Task in Phase 3

#### Task 3.3: Add Resume/Retry Capability
**Files**: `src/cli.ts`, `src/business/seedShopifyOrders/SeedShopifyOrdersUseCase.ts`
**Goal**: Allow resuming failed operations
**Steps**:
1. Store progress state (which orders succeeded)
2. Add `--resume <batch-id>` flag
3. Load progress state from batch ID
4. Allow retry of failed orders only
5. Show resume options on failure

**Acceptance Criteria**:
- Can resume from batch ID
- Only failed orders retried
- Progress state stored correctly
- Resume options shown on failure

**Effort**: Large | **Risk**: Medium

### ADD: New Task in Phase 4

#### Task 4.3: Add Incremental Validation Feedback
**Files**: `src/generateConfig.ts`
**Goal**: Validate as config is built
**Steps**:
1. Validate orders as they're created
2. Show warnings for potential issues
3. Validate collection prep configuration as it's built
4. Show validation status in review step
5. Prevent invalid configs from being saved

**Acceptance Criteria**:
- Validation happens incrementally
- Warnings shown for issues
- Invalid configs prevented
- Validation status visible

**Effort**: Medium | **Risk**: Low

### CHANGE: Task 2.3 (Add Confirmation Before Saving)

**Before**:
```markdown
#### Task 2.3: Add Confirmation Before Saving
**Files**: `src/generateConfig.ts`
**Goal**: Prevent accidental overwrites
**Steps**:
1. Show config summary before saving
2. Add confirmation prompt
3. Display file path and key details
4. Allow cancellation
```

**After**:
```markdown
#### Task 2.3: Add Confirmation and Preview Before Saving
**Files**: `src/generateConfig.ts`
**Goal**: Prevent accidental overwrites and allow review
**Steps**:
1. Add preview option: "Preview config before saving? (y/n)"
2. Show config summary (key details, not full JSON) if preview chosen
3. Add confirmation prompt: "Save to output/seed-config.json? (y/n)"
4. Display file path and key details
5. Warn if file exists: "File exists. Overwrite? (y/n)"
6. Allow cancellation at any point
```

### CHANGE: Testing & Quality Gates Section (line 503-524)

**Before**:
```markdown
### Manual Testing Checklist

- [ ] Seeding CLI shows progress indicators
- [ ] Seeding CLI shows actionable error messages
- [ ] Config generator shows progress during bulk operations
- [ ] Config generator shows confirmation before saving
- [ ] Error messages include recovery suggestions
- [ ] All existing functionality still works
```

**After**:
```markdown
### Manual Testing Checklist

- [ ] Seeding CLI shows progress indicators
- [ ] Seeding CLI shows actionable error messages
- [ ] Seeding CLI shows partial failure summary
- [ ] Seeding CLI shows progress within steps (order-by-order)
- [ ] Config generator shows progress during bulk operations
- [ ] Config generator shows confirmation and preview before saving
- [ ] Config generator shows initialization progress
- [ ] Error messages include recovery suggestions and context
- [ ] Help and version flags work in both tools
- [ ] Resume/retry capability works
- [ ] All existing functionality still works
```

### ADD: New Section After "Observability & Explainability"

#### Error Recovery & Resilience

### Error Recovery
- Partial failure handling with user choice (continue/abort)
- Resume capability for failed operations
- Retry failed orders only
- Clear failure summaries with context

### Resilience
- Graceful degradation (continue with partial success)
- Clear indication of what succeeded vs failed
- Options to recover from failures
- Batch ID tracking for resume

## 5) Open Questions (max 10)

1. **Resume Storage**: Where should progress state be stored? (File system, database, or in-memory only for session?)

2. **Failure Threshold**: At what point should we abort vs continue? (e.g., if 50% of orders fail, auto-abort?)

3. **Help Format**: Should help be formatted with colors/formatting library, or plain text for maximum compatibility?

4. **Progress Update Frequency**: How often should progress updates be shown? (Every order, every N orders, time-based?)

5. **Preview Format**: For config preview, should we show full JSON, summary table, or both with option to toggle?

6. **Version Source**: Should version come from package.json, git tag, or separate version file?

7. **CLI Library**: Which CLI argument parser should we use? (commander.js, yargs, or build custom?)

8. **Resume Scope**: Should resume work across sessions (persist to disk) or only within same session?

9. **Validation Strictness**: Should incremental validation prevent invalid configs or just warn?

10. **Error Recovery Default**: Should continue-on-error be default behavior or opt-in via flag?
